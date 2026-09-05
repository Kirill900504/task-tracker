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
    "Ты помогаешь быстро завести записи в личном таск-трекере по одной фразе на русском языке.",
    "Ответь РОВНО ОДНИМ JSON-МАССИВОМ объектов, без markdown-разметки, без пояснений до или после — только сам JSON, начиная с символа [.",
    "В одной фразе может быть НЕСКОЛЬКО разных поручений сразу (например: задача + две мысли + встреча одним сообщением) — тогда верни несколько элементов массива, по одному на каждое отдельное поручение. Если поручение одно — в массиве всё равно один элемент.",
    "Каждый элемент массива — отдельный JSON-объект, поле type определяет его структуру — используй ровно одну из семи:",
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
    "   — фразу целиком нельзя уверенно разобрать (например, не хватает ключевой детали) — короткий уточняющий вопрос вместо угадывания. Используй, только если ВСЯ фраза непонятна; если непонятна лишь часть многосоставной фразы — обработай понятные поручения, а неясную часть пропусти.",
    "",
    '5) {"type":"manage_item","action":"complete"|"success"|"no_result"|"reopen"|"delete","itemType":"task"|"meeting","query":string}',
    "   — просьба изменить УЖЕ СУЩЕСТВУЮЩУЮ задачу или встречу (не создать новую): отметить выполненной, отметить итог встречи, вернуть в работу/план или удалить.",
    "   action=\"complete\" — только itemType=\"task\" (отметить задачу сделанной).",
    "   action=\"success\"/\"no_result\" — только itemType=\"meeting\" (итог встречи).",
    "   action=\"reopen\" — вернуть завершённую задачу или состоявшуюся/несостоявшуюся встречу обратно в работу/план.",
    "   action=\"delete\" — удалить безвозвратно (задачу или встречу).",
    "   query: короткий фрагмент названия дословно, как назвал пользователь — НЕ придумывай и не дополняй его.",
    "",
    '6) {"type":"question","query":string}',
    "   — ВОПРОС о том, что уже есть в трекере: «что у меня сегодня/завтра», «что горит», «сколько задач на Наталье», «что там по опту», «когда встреча с Игорем», «что я записывал про склад».",
    "   query: вопрос пользователя дословно. Отвечать на него ты здесь не должен — на него ответит отдельный шаг, который видит данные трекера.",
    "   Признак вопроса — пользователь ХОЧЕТ УЗНАТЬ что-то о своих делах, а не завести или изменить запись.",
    "",
    '7) {"type":"other"}',
    "   — фраза (или её часть, если поручений несколько) не является ни поручением, ни вопросом о трекере: комментарий, благодарность, болтовня.",
    "   Никогда не повторяй и не пересказывай его сообщение.",
    "",
    "Примеры формы ответа:",
    'Одно поручение → [{"type":"task","title":"...","description":"","assignee":"","priority":"med","term":"short","deadline":""}]',
    'Несколько поручений одной фразой → [{"type":"task",...}, {"type":"idea",...}, {"type":"idea",...}, {"type":"meeting",...}]',
    // The question type needs its own example: without one the model kept
    // trying to *answer* counting questions ("сколько задач на Наталье?") in
    // prose instead of returning JSON, which failed the parse outright.
    'Вопрос о делах → [{"type":"question","query":"сколько задач на Наталье"}]',
    'Ещё вопрос → [{"type":"question","query":"что у меня завтра"}]',
    "На вопрос НИКОГДА не отвечай текстом — верни JSON с type=question, ответ сформирует другой шаг.",
  ].join("\n");
}

// Extracts a JSON array from the model's raw text response. Tolerates a
// bare object too (wraps it in a single-element array) — smaller/free-tier
// models don't always follow the "always an array" instruction exactly.
function extractJsonArray(raw: string): unknown[] {
  const trimmed = raw.trim();
  const arrStart = trimmed.indexOf("[");
  const objStart = trimmed.indexOf("{");
  const useArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart);

  if (useArray) {
    const end = trimmed.lastIndexOf("]");
    if (end === -1 || end < arrStart) throw new Error("В ответе нет JSON-массива");
    const parsed = JSON.parse(trimmed.slice(arrStart, end + 1));
    if (!Array.isArray(parsed)) throw new Error("Ожидался массив");
    return parsed;
  }
  if (objStart !== -1) {
    const end = trimmed.lastIndexOf("}");
    if (end === -1 || end < objStart) throw new Error("В ответе нет JSON");
    return [JSON.parse(trimmed.slice(objStart, end + 1))];
  }
  throw new Error("В ответе нет JSON");
}

export const TOOL_BY_TYPE: Record<string, string> = {
  task: "create_task",
  meeting: "create_meeting",
  idea: "create_idea",
  clarify: "ask_clarifying_question",
  manage_item: "manage_item",
  question: "answer_question",
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

export type QuickAddItem = { tool: string; input: Record<string, unknown>; droppedNames: string[] };
export type QuickAddParsed = { items: QuickAddItem[] };

export async function parseQuickAdd(text: string, assignees: string[]): Promise<QuickAddParsed> {
  const system = systemPrompt(new Date(), assignees);

  let parsed: unknown[] | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const raw = await gigaChatComplete({
        system: attempt === 0 ? system : system + "\n\nВАЖНО: ответь ТОЛЬКО валидным JSON-массивом, без единого лишнего символа.",
        user: text,
      });
      const candidates = extractJsonArray(raw).filter(
        (c): c is Record<string, unknown> => !!c && typeof c === "object" && "type" in c,
      );
      if (candidates.length) parsed = candidates;
      else lastError = "Ответ без элементов с полем type";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!parsed) throw new Error("GigaChat: " + lastError);

  const items: QuickAddItem[] = [];
  for (const p of parsed) {
    const type = String((p as Record<string, unknown>).type);
    const tool = TOOL_BY_TYPE[type];
    if (!tool) continue; // an unknown type from one element shouldn't sink the whole batch
    const { type: _omit, ...input } = p as Record<string, unknown>;
    void _omit;
    const droppedNames = sanitizeAgainstKnown(input, assignees);
    items.push({ tool, input, droppedNames });
  }
  if (!items.length) throw new Error("Не удалось разобрать ни одного элемента");

  return { items };
}
