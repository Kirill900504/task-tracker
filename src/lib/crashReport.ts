// Как одна поломка отличается от другой, и когда о ней говорить вслух.
//
// Две крайности одинаково бесполезны. Молчать — это то, что было до
// 19.09.2026: о белом экране узнавал Кирилл, а мы от него. Говорить о
// каждой строке — ещё хуже: падение, случившееся в цикле отрисовки (а
// именно так трекер и падал в тот день), отправит сотню сообщений в минуту,
// и следующее настоящее уведомление утонет среди них.
//
// Отсюда две функции: отпечаток — чтобы понять, что это ТА ЖЕ САМАЯ
// поломка, и окно тишины — чтобы сказать о ней один раз.

// Всё, что делает один и тот же сбой непохожим на себя же: адреса, номера,
// идентификаторы задач, время. Без этого четырнадцать человек с одной
// поломкой дают четырнадцать разных отпечатков, и смысл склейки теряется.
export function fingerprintOf(message: string, stack?: string): string {
  const head = (message || "неизвестная ошибка").split("\n")[0];
  const line = (stack || "").split("\n").find((l) => l.includes("/_next/")) || "";
  return (head + " @ " + line)
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/[0-9a-f]{8,}/gi, "")
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

// Сообщение владельцу — только о новой поломке. «Новая» значит: с таким
// отпечатком за последний час не приходило ничего.
export const NOTICE_WINDOW_MS = 60 * 60 * 1000;

export function shouldNotify(lastSeenAt: string | null, now: number = Date.now()): boolean {
  if (!lastSeenAt) return true;
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return true;
  return now - seen > NOTICE_WINDOW_MS;
}

// Жёсткий предел на запись. Падение в цикле шлёт столько строк, сколько
// успеет отрисовать браузер, — и это не преувеличение: ровно так и было.
// Пять строк в минуту от одного человека достаточно, чтобы увидеть
// поломку, и мало, чтобы залить базу.
export const WRITE_LIMIT = 5;
export const WRITE_WINDOW_MS = 60 * 1000;

export function tooMany(recentCount: number): boolean {
  return recentCount >= WRITE_LIMIT;
}

// Текст, который придёт в мессенджер. Пишется здесь, а не в маршруте, по
// той же причине, по какой все тексты живут отдельно: его читает человек,
// и его надо уметь проверить тестом.
export function crashNotice(input: { message: string; url?: string | null; release?: string | null; who?: string | null }): string {
  const lines = [
    "⚠️ Трекер сломался на экране" + (input.who ? " у " + input.who : ""),
    "",
    input.message.split("\n")[0].slice(0, 300),
  ];
  const where = (input.url || "").replace(/^https?:\/\/[^/]+/, "");
  if (where) lines.push("", "Страница: " + where);
  if (input.release) lines.push("Версия: " + input.release);
  lines.push("", "Это записано целиком — я разберу по журналу.");
  return lines.join("\n");
}
