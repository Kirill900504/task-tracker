import { gigaChatComplete } from "@/lib/gigachat/client";
import { isoDate, addDays, nextWeekdayMap, sanitizeAgainstKnown } from "@/lib/quickAdd";
import { stem, sharesPrefix } from "@/lib/stem";

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

// The one failure that survived every prompt fix: about one run in three
// quietly drops a task — most often one said without a deadline. A missed
// task is invisible (you cannot review a list for what is not on it),
// while an extra one is right there to be spotted, so the trade is worth
// making: a second pass is asked what the first one left out.
//
// Its output is not trusted on its own. Merging happens here: anything
// already in the list is dropped, and a supposedly missed task whose own
// words do not appear in what was actually said is dropped too — that is
// the shape an invented task takes.
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4)
    .map(stem)
    // Sorted, so the same instruction phrased in another order — «смета
    // по складу» vs «по складу смета» — collapses to the same key.
    .sort()
    .join(" ");
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4);
}


function isGrounded(title: string, source: string): boolean {
  const hay = words(source);
  const titleWords = words(title);
  if (!titleWords.length) return false;
  // A shared five-letter opening counts as the same word: verb forms are
  // what the stemmer cannot line up («посмотрит» vs «посмотреть»), and the
  // point here is only to tell a rewording of what was said from a new
  // subject nobody mentioned.
  const hits = titleWords.filter((w) => hay.some((h) => sharesPrefix(w, h, 5))).length;
  // Half the meaningful words of the task have to come from the story
  // itself — a rewording of something said passes, a new subject does not.
  return hits * 2 >= titleWords.length;
}

export const MAX_EXTRA_TASKS = 3;

export function mergeMissedTasks(found: ExtractedTask[], extra: ExtractedTask[], source: string): ExtractedTask[] {
  const seen = new Set(found.map((t) => normalizeTitle(t.title)));
  const merged = [...found];
  for (const t of extra) {
    if (merged.length >= found.length + MAX_EXTRA_TASKS) break;
    const key = normalizeTitle(t.title);
    if (!key || seen.has(key)) continue;
    if (!isGrounded(t.title, source)) continue;
    seen.add(key);
    merged.push(t);
  }
  return merged;
}

function secondPassPrompt(now: Date, assignees: string[], found: ExtractedTask[]): string {
  return [
    systemPrompt(now, assignees),
    "",
    "=== УЖЕ ВЫПИСАНО ===",
    found.map((t, i) => `${i + 1}) ${t.title}`).join("\n") || "(пусто)",
    "=== КОНЕЦ ===",
    "",
    "Сейчас твоя задача другая: найди поручения, которых в этом списке НЕТ.",
    "Верни тем же форматом ТОЛЬКО пропущенные поручения. Если ничего не пропущено — верни пустой массив tasks.",
    "Не повторяй уже выписанное другими словами. Не добавляй ничего, чего не было в рассказе.",
  ].join("\n");
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

  const summary = String(parsed.summary || "").trim();
  const tasks = parseTasks(parsed, assignees, now);

  // Second pass: what did the first one miss? Best-effort — if it fails or
  // returns nothing usable, the first pass's list stands unchanged.
  try {
    const raw = await gigaChatComplete({ system: secondPassPrompt(now, assignees, tasks), user: text });
    const extra = parseTasks(extractJsonObject(raw), assignees, now);
    return { summary, tasks: mergeMissedTasks(tasks, extra, text) };
  } catch {
    return { summary, tasks };
  }
}

function parseTasks(parsed: Record<string, unknown>, assignees: string[], now: Date): ExtractedTask[] {
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

  return tasks;
}
