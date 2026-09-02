import { gigaChatComplete } from "@/lib/gigachat/client";

// Shared natural-language parsing used by both the web quick-add bar
// (/api/quick-add) and the Telegram bot (/api/telegram/webhook) — one
// prompt, one behavior, regardless of where the message came from.

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

// Free-tier models are unreliable at weekday arithmetic in their head — even
// a full calendar table in the prompt got ignored in testing. Handing over
// each weekday's *already-resolved next date* (computed here in code, not
// left for the model to work out) is what actually produced correct results.
export function nextWeekdayMap(now: Date): string {
  const map = new Map<number, string>();
  for (let i = 0; i < 7; i++) {
    const d = addDays(now, i);
    if (!map.has(d.getDay())) map.set(d.getDay(), isoDate(d));
  }
  return WEEKDAYS.map((_, wd) => `${WEEKDAYS[wd]} → ${map.get(wd)}`).join("\n");
}

function systemPrompt(now: Date, assignees: string[]) {
  return [
    `Сегодня ${isoDate(now)} (${WEEKDAYS[now.getDay()]}). Часовой пояс пользователя — Europe/Moscow.`,
    `«завтра» = ${isoDate(addDays(now, 1))}. «послезавтра» = ${isoDate(addDays(now, 2))}. «через неделю» = ${isoDate(addDays(now, 7))}.`,
    "Если в фразе назван день недели («в пятницу», «во вторник» и т.п.) — БЕРИ ГОТОВУЮ ДАТУ ИЗ ЭТОЙ ТАБЛИЦЫ, ни в коем случае не вычисляй сам:",
    nextWeekdayMap(now),
    `Список исполнителей, которых знает система: ${assignees.length ? assignees.join(", ") : "(пусто)"}.`,
    "Ты помогаешь быстро завести запись в личном таск-трекере по одной фразе на русском языке.",
    "Разбери фразу и ответь РОВНО ОДНИМ JSON-объектом, без markdown-разметки, без пояснений до или после — только сам JSON, начиная с символа {.",
    "Поле type определяет структуру остальных полей — используй ровно одну из четырёх:",
    "",
    '1) {"type":"task","title":string,"description":string,"assignee":string,"priority":"high"|"med","term":"short"|"long","deadline":string}',
    "   — что-то, что нужно сделать. assignee: СКОПИРУЙ имя буква-в-букву из списка исполнителей выше. Если точного совпадения нет — пустая строка. Категорически запрещено писать любое имя, которого нет в списке дословно.",
    "   priority: high — если явно важно/срочно, иначе med. term: long — если срок дальше месяца или явно долгосрочная задача, иначе short.",
    "   deadline: дата из таблицы выше в формате YYYY-MM-DD. Пустая строка, если дата не названа.",
    "",
    '2) {"type":"meeting","title":string,"date":string,"time":string,"participants":string[]}',
    "   — явно названы дата/время встречи. date: YYYY-MM-DD из таблицы выше. time: HH:MM (24ч) или пустая строка. participants: имена буква-в-букву из списка выше, без придуманных.",
    "",
    '3) {"type":"idea","text":string,"important":boolean}',
    "   — просто мысль/наблюдение без срока и исполнителя. important: true только если пользователь явно подчеркнул важность.",
    "",
    '4) {"type":"clarify","question":string}',
    "   — фразу нельзя уверенно разобрать (например, не хватает ключевой детали) — короткий уточняющий вопрос вместо угадывания.",
    "",
    '5) {"type":"other"}',
    "   — фраза НЕ является просьбой создать задачу/встречу/идею: вопрос про уже сделанное, комментарий, благодарность, что угодно вне этих трёх категорий.",
    "   Используй именно этот тип, а не clarify, если пользователь не пытается ничего завести, а спрашивает или комментирует. Никогда не повторяй и не пересказывай его сообщение.",
  ].join("\n");
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("В ответе нет JSON");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export const TOOL_BY_TYPE: Record<string, string> = {
  task: "create_task",
  meeting: "create_meeting",
  idea: "create_idea",
  clarify: "ask_clarifying_question",
  other: "cant_help",
};

// Belt-and-suspenders: never trust the model to have actually honored the
// "only names from the list" instruction — enforce it here regardless.
// Returns the names that got dropped, so the caller can tell the user why
// (dropping silently is what caused real confusion in practice — the user
// had no way to know "Козлов" just wasn't in the assignee list).
export function sanitizeAgainstKnown(input: Record<string, unknown>, known: string[]): string[] {
  const dropped: string[] = [];
  if (typeof input.assignee === "string" && input.assignee && !known.includes(input.assignee)) {
    dropped.push(input.assignee);
    input.assignee = "";
  }
  if (Array.isArray(input.participants)) {
    const kept: string[] = [];
    for (const n of input.participants) {
      if (typeof n !== "string") continue;
      if (known.includes(n)) kept.push(n);
      else dropped.push(n);
    }
    input.participants = kept;
  }
  return dropped;
}

export type QuickAddParsed = { tool: string; input: Record<string, unknown>; droppedNames: string[] };

export async function parseQuickAdd(text: string, assignees: string[]): Promise<QuickAddParsed> {
  const system = systemPrompt(new Date(), assignees);

  let parsed: Record<string, unknown> | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const raw = await gigaChatComplete({
        system: attempt === 0 ? system : system + "\n\nВАЖНО: ответь ТОЛЬКО валидным JSON, без единого лишнего символа.",
        user: text,
      });
      const candidate = extractJson(raw);
      if (candidate && typeof candidate === "object" && "type" in candidate) {
        parsed = candidate as Record<string, unknown>;
      } else {
        lastError = "Ответ без поля type";
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!parsed) throw new Error("GigaChat: " + lastError);

  const type = String(parsed.type);
  const tool = TOOL_BY_TYPE[type];
  if (!tool) throw new Error("Неизвестный тип: " + type);

  const { type: _omit, ...input } = parsed;
  void _omit;
  const droppedNames = sanitizeAgainstKnown(input, assignees);

  return { tool, input, droppedNames };
}
