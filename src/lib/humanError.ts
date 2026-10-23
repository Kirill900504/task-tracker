// Сообщение об ошибке, которое можно показать человеку.
//
// Когда запрос не дошёл до сервера вовсе (мобильный интернет моргнул,
// соединение оборвалось, сеть не пускает), браузер бросает TypeError со
// словами, которые пишет он сам: «Failed to fetch» в Chrome, «Load failed»
// в Safari, «NetworkError when attempting to fetch resource» в Firefox.
// Ровно это и увидел Юрий Нодберг 25.09.2026 под кнопкой «Подключить
// Telegram» — два английских слова, которые не говорят ни что случилось,
// ни что делать. Код показывал `e.message` как есть в двух десятках мест,
// и правило «каждая ошибка по-русски» нарушалось в каждом из них сразу.
//
// Одна функция на все места, а не замена текста в каждом: следующее место,
// где ошибку покажут как есть, иначе снова будет говорить по-английски.

export const NETWORK_TEXT = "Нет связи с сервером трекера. Проверьте интернет и нажмите ещё раз.";

const NETWORK_PATTERNS = [
  /failed to fetch/i,
  /load failed/i,
  /networkerror/i,
  /network request failed/i,
  /fetch failed/i,
  /the internet connection appears to be offline/i,
];

// Supabase does not throw on a dropped request: it returns an error OBJECT
// `{ message: "TypeError: Failed to fetch", code: "" }`. A real refusal from
// the database always carries a code, so "no code + network words" is the
// network and nothing else.
export function isNetworkError(e: unknown): boolean {
  let message = "";
  if (e instanceof Error) message = e.message;
  else if (typeof e === "string") message = e;
  else if (e && typeof e === "object") {
    const { message: m, code } = e as { message?: unknown; code?: unknown };
    if (code) return false;
    message = typeof m === "string" ? m : "";
  }
  return NETWORK_PATTERNS.some((re) => re.test(message));
}

export function humanError(e: unknown, fallback: string): string {
  if (isNetworkError(e)) return NETWORK_TEXT;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
