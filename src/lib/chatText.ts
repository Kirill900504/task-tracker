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

export type TextPart = string | { url: string; text: string };

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0];
    const trail = raw.match(/[.,!?;:)\]»]+$/);
    if (trail) raw = raw.slice(0, -trail[0].length);
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push({ url: raw.startsWith("www.") ? "https://" + raw : raw, text: raw });
    last = at + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Прокручена ли лента к низу — с запасом, потому что «почти внизу» для
// глаза то же самое, а дробные пиксели прокрутки бывают у всех.
export function nearBottom(scrollTop: number, clientHeight: number, scrollHeight: number, slack = 48): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}
