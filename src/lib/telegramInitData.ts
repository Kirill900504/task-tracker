import { createHmac, timingSafeEqual } from "node:crypto";

// Кто открыл мини-приложение — и доказательство, что это правда он.
//
// Мини-приложение Telegram получает от мессенджера строку `initData`: кто
// нажал, когда, в каком чате. Строка приходит ИЗ БРАУЗЕРА, то есть её
// может прислать кто угодно и с любым содержимым — и потому единственное,
// что делает её доказательством, это подпись. Telegram подписывает строку
// ключом, выведенным из токена бота: подделать её, не зная токена, нельзя,
// а токен не покидает сервер.
//
// Здесь это особенно важно: по итогу проверки человек получает СЕССИЮ в
// трекере — то же самое, что вход по паролю. Ошибка в этой функции равна
// отданному паролю, поэтому она делает ровно одно и проверяется тестами
// на подложных данных, а не только на честных.
//
// Устройство подписи (документация Telegram, «Validating data received via
// the Mini App»):
//   secret = HMAC_SHA256(key = "WebAppData", message = <токен бота>)
//   hash   = HMAC_SHA256(key = secret,       message = <пары ключ=значение,
//                                              кроме hash, отсортированные
//                                              по ключу, через \n>)

export type InitDataUser = { id: number; first_name?: string; last_name?: string; username?: string };

export type InitDataCheck =
  | { ok: true; user: InitDataUser; authDate: number }
  | { ok: false; error: string };

// Сколько живёт подпись. Мини-приложение открывают и сразу входят, так что
// час — это с запасом; сутки означали бы, что перехваченная строка
// открывает трекер до завтра.
const MAX_AGE_SECONDS = 60 * 60;

export function checkInitData(initData: string, botToken: string, now = Date.now()): InitDataCheck {
  if (!initData) return { ok: false, error: "Пустые данные входа" };
  if (!botToken) return { ok: false, error: "Бот не настроен" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "Нет подписи" };

  // Подпись считается по всем полям, КРОМЕ самой подписи, отсортированным
  // по имени. `signature` тоже исключается: это отдельная подпись третьих
  // сторон (Ed25519), в hash она не входит, и её появление в новых версиях
  // Telegram ломало проверку у тех, кто перечислял поля вручную.
  const pairs: string[] = [];
  for (const [key, value] of [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (key === "hash" || key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");

  // Сравнение постоянного времени: обычное `===` выходит из цикла на
  // первом несовпавшем байте, и по времени ответа подпись подбирается по
  // одному символу. Длина сверяется отдельно — timingSafeEqual на буферах
  // разной длины бросает исключение.
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: "Подпись не сходится" };

  // Свежесть. Строка со старой датой подписана честно — тем и опасна:
  // однажды перехваченная, она работала бы вечно.
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate) return { ok: false, error: "Нет даты входа" };
  const age = Math.floor(now / 1000) - authDate;
  if (age > MAX_AGE_SECONDS) return { ok: false, error: "Данные входа устарели — откройте окно заново" };
  // Дата из будущего означает подделку или разъехавшиеся часы; минута
  // допуска закрывает второе, не открывая первого.
  if (age < -60) return { ok: false, error: "Дата входа из будущего" };

  let user: InitDataUser;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    return { ok: false, error: "Не разобрал, кто это" };
  }
  if (!user?.id) return { ok: false, error: "Не разобрал, кто это" };

  return { ok: true, user, authDate };
}
