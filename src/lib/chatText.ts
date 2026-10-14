// Мелкие правила поля ввода и ленты обсуждения — отдельно от разметки,
// чтобы проверялись без браузера (chatText.test.ts).

// Вставить текст на место курсора (или выделения) и вернуть, где курсор
// окажется после. Смайлик, вставленный в конец, когда курсор стоял в
// середине фразы, — первое, что раздражает в самодельном поле.
export function insertAt(value: string, start: number, end: number, insert: string): { value: string; caret: number } {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  return { value: value.slice(0, from) + insert + value.slice(to), caret: from + insert.length };
}

// Ссылки в тексте — кусками: строка или ссылка. Только http(s) и www.:
// голое «site.ru» слишком часто оказывается концом предложения с точкой.
// Хвостовая пунктуация не входит в ссылку — «смотри https://x.ru/a.» ведёт
// на /a, а не на /a.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

export type TextPart = string | { url: string; text: string } | { taskNumber: number; text: string };

// «#107» в реплике — ссылка на задачу с этим номером (предложение 8 от
// 13.10.2026, одобрено 14.10.2026: «см. #107» нажимается и открывает ту
// задачу, как в Linear и Jira). Номер — сразу после «#», до шести цифр, и
// «#» не внутри слова: «abc#12» ссылкой не становится, а якорь в адресе
// сюда не доходит вовсе — ссылки разбираются раньше и целиком.
const TASK_RE = /(^|[^\p{L}\p{N}_&/])#(\d{1,6})(?!\d)/gu;

function splitTaskNumbers(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TASK_RE)) {
    const at = (m.index ?? 0) + m[1].length;
    if (at > last) parts.push(text.slice(last, at));
    parts.push({ taskNumber: Number(m[2]), text: "#" + m[2] });
    last = at + 1 + m[2].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0];
    const trail = raw.match(/[.,!?;:)\]»]+$/);
    if (trail) raw = raw.slice(0, -trail[0].length);
    const at = m.index ?? 0;
    if (at > last) parts.push(...splitTaskNumbers(text.slice(last, at)));
    parts.push({ url: raw.startsWith("www.") ? "https://" + raw : raw, text: raw });
    last = at + raw.length;
  }
  if (last < text.length) parts.push(...splitTaskNumbers(text.slice(last)));
  return parts;
}

// Как «#107» открывает задачу. Лента обсуждения живёт внутри окна задачи и
// о списке задач ничего не знает, поэтому нажатие — событие окна, а
// открывает задачу корень трекера (NewTracker), где есть видимые задачи:
// чужую, невидимую мне задачу номер не откроет.
export const OPEN_TASK_NUMBER_EVENT = "rokas:open-task-number";

// Прокручена ли лента к низу — с запасом, потому что «почти внизу» для
// глаза то же самое, а дробные пиксели прокрутки бывают у всех.
export function nearBottom(scrollTop: number, clientHeight: number, scrollHeight: number, slack = 48): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}
