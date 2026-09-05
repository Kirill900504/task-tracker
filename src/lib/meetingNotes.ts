import { gigaChatComplete } from "@/lib/gigachat/client";
import { isoDate, addDays, nextWeekdayMap, sanitizeAgainstKnown } from "@/lib/quickAdd";

// "Разбор итогов встречи": you come out of a meeting, dictate what was
// agreed in one go, and the bot pulls the action items out of it — who has
// to do what, by when — instead of you dictating each task separately.
//
// Unlike quick-add, nothing here is created straight away: the extracted
// list is shown first and only created after an explicit "да". A monologue
// about a meeting is exactly the kind of input where a model will
// occasionally invent a task out of a passing remark, so a human check
// stands between it and the tracker.

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export type ExtractedTask = {
  title: string;
  assignee: string;
  deadline: string;
  priority: "high" | "med";
};

export type MeetingNotesResult = {
  summary: string;
  tasks: ExtractedTask[];
};

function systemPrompt(now: Date, assignees: string[]): string {
  return [
    `Сегодня ${isoDate(now)} (${WEEKDAYS[now.getDay()]}). Часовой пояс — Europe/Moscow.`,
    `«завтра» = ${isoDate(addDays(now, 1))}. «послезавтра» = ${isoDate(addDays(now, 2))}. «через неделю» = ${isoDate(addDays(now, 7))}.`,
    "Если назван день недели — БЕРИ ГОТОВУЮ ДАТУ ИЗ ТАБЛИЦЫ, не вычисляй сам:",
    nextWeekdayMap(now),
    `Список исполнителей, которых знает система: ${assignees.length ? assignees.join(", ") : "(пусто)"}.`,
    "",
    "Пользователь надиктовал итоги прошедшей встречи или совещания. Твоя задача — вытащить из этого рассказа ПОРУЧЕНИЯ (что кому нужно сделать).",
    "Ответь РОВНО ОДНИМ JSON-объектом, без markdown и пояснений, начиная с символа {:",
    '{"summary":string,"tasks":[{"title":string,"assignee":string,"when":string,"priority":"high"|"med"}]}',
    "",
    "summary — одно-два предложения: о чём была встреча и что решили. Без воды.",
    "tasks — только реальные поручения, которые кто-то должен выполнить.",
    "  title — само действие, коротко и по делу, как формулировка задачи.",
    "  assignee — имя буква-в-букву из списка исполнителей выше. Если человек не назван или его нет в списке дословно — пустая строка. Придумывать имена категорически запрещено.",
    // The model is asked for a LABEL, not a date. Given a date field it
    // resolved "до пятницы" to the wrong day even with the weekday table
    // right there in the prompt; picking one word from a fixed list is
    // something it does reliably, and the calendar maths happens in code.
    '  when — КОГДА срок, одним словом из этого списка: "none" (срок не назван), "today", "tomorrow", "day_after", "this_week", "next_week", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday".',
    "        НИКОГДА не пиши сюда дату числом — только слово из списка. Дату подставит система сама.",
    "  priority — high ТОЛЬКО если про ЭТО конкретное поручение сказано «срочно», «важно», «горит». Про соседнее поручение сказали срочно — на это не переносится. По умолчанию med.",
    "",
    "ПЕРЕЧИСЛИ ВСЕ ПОРУЧЕНИЯ ДО ЕДИНОГО. Пройди рассказ по порядку и выпиши каждое действие, которое кому-то предстоит сделать.",
    "Проверь себя перед ответом: пройдись по КАЖДОМУ упомянутому человеку и убедись, что его поручение попало в список.",
    "Частая ошибка — пропустить поручение без срока («сроки не горят», «когда будет время», «как освободится»). Срок не обязателен: такое поручение всё равно попадает в список, просто с when=\"none\".",
    "",
    "НЕ превращай в задачи обсуждения, наблюдения, идеи «на будущее» и то, что уже сделано. Только то, что осталось сделать.",
    "Если поручений в рассказе нет вообще — верни пустой массив tasks, но summary всё равно заполни.",
  ].join("\n");
}

// Turns the model's one-word "when" into a real date. All calendar maths
// lives here rather than in the prompt — see the `when` field's comment.
const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export function resolveWhen(when: string, now: Date): string {
  const key = String(when || "").trim().toLowerCase();
  if (!key || key === "none") return "";
  if (key === "today") return isoDate(now);
  if (key === "tomorrow") return isoDate(addDays(now, 1));
  if (key === "day_after") return isoDate(addDays(now, 2));
  if (key === "next_week") return isoDate(addDays(now, 7));
  // "На этой неделе" without a day named: the end of the working week is the
  // most useful reading of it, and never a date already in the past.
  if (key === "this_week") {
    const daysToFriday = (5 - now.getDay() + 7) % 7;
    return isoDate(addDays(now, daysToFriday));
  }
  const target = WEEKDAY_INDEX[key];
  if (target === undefined) return "";
  // The next occurrence of that weekday, today included (a Monday task said
  // to be "к понедельнику" on a Monday means today, not a week out).
  const delta = (target - now.getDay() + 7) % 7;
  return isoDate(addDays(now, delta));
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("В ответе нет JSON-объекта");
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Ожидался объект");
  return parsed as Record<string, unknown>;
}

export async function extractMeetingNotes(text: string, assignees: string[]): Promise<MeetingNotesResult> {
  const now = new Date();
  const system = systemPrompt(now, assignees);

  let parsed: Record<string, unknown> | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const raw = await gigaChatComplete({
        system: attempt === 0 ? system : system + "\n\nВАЖНО: ответь ТОЛЬКО валидным JSON-объектом, без единого лишнего символа.",
        user: text,
      });
      parsed = extractJsonObject(raw);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  if (!parsed) throw new Error("GigaChat: " + lastError);

  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const tasks: ExtractedTask[] = [];
  for (const rt of rawTasks) {
    if (!rt || typeof rt !== "object") continue;
    const input = rt as Record<string, unknown>;
    const title = String(input.title || "").trim();
    if (!title) continue;
    // Same guard as quick-add: an assignee the system doesn't know is
    // dropped rather than written into the task as free text.
    sanitizeAgainstKnown(input, assignees);
    // A model that ignores the instruction and writes a date anyway is still
    // accepted, as long as it looks like one — but the label is what's
    // expected and what gets resolved here.
    const rawWhen = String(input.when || "");
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(rawWhen) ? rawWhen : resolveWhen(rawWhen, now);
    tasks.push({
      title,
      assignee: String(input.assignee || ""),
      deadline,
      priority: input.priority === "high" ? "high" : "med",
    });
  }

  return { summary: String(parsed.summary || "").trim(), tasks };
}
