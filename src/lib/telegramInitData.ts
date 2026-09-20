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
  // `fields` — ИМЕНА пришедших полей, без значений. Нужны потому, что
  // настоящую подпись Telegram здесь нельзя ни подделать, ни повторить:
  // единственный способ увидеть, из чего она считалась, — посмотреть,
  // что вообще пришло. Ровно на этом 20.09.2026 потерялся день —
  // проверка отвергала всех, а сказать почему было нечем.
  // Значения не отдаются никогда: в них имя, фото и идентификаторы.
  | { ok: false; error: string; fields?: string[] };

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

  // Подпись считается по ВСЕМ пришедшим полям, кроме самой подписи,
  // отсортированным по имени. Документация Telegram: «a chain of all
  // received fields, sorted alphabetically» — исключается только `hash`.
  //
  // Именно это место 20.09.2026 не пустило Кирилла в трекер, и ошибка
  // поучительная. `signature` — вторая, отдельная подпись (Ed25519, для
  // третьих сторон, которым нельзя давать токен бота), и её описание
  // говорит «except hash and signature». Слова похожи, алгоритмы разные:
  // в нашу, HMAC-проверку, `signature` ВХОДИТ как обычное поле. Я исключил
  // его «за компанию» — и не заметил, потому что подписывал тестовые
  // данные сам, тем же кодом: проверка сошлась с собственной ошибкой. В
  // настоящих данных Telegram `signature` есть всегда, и вход отвечал
  // «Подпись не сходится» у всех.
  //
  // Вывод, который дороже правки: проверку подписи нельзя испытывать
  // данными, которые подписал ты сам. Сходится не подпись, а твоё
  // представление о ней.
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const sorted = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const dataCheckString = sorted.filter(([k]) => k !== "hash").map(([k, v]) => `${k}=${v}`).join("\n");

  const given = Buffer.from(hash, "hex");
  const matches = (candidate: string): boolean => {
    const expected = Buffer.from(createHmac("sha256", secret).update(candidate).digest("hex"), "hex");
    // Сравнение постоянного времени: обычное `===` выходит из цикла на
    // первом несовпавшем байте, и по времени ответа подпись подбирается
    // по одному символу. Длина сверяется отдельно — timingSafeEqual на
    // буферах разной длины бросает исключение.
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  let ok = matches(dataCheckString);
  if (!ok && params.has("signature")) {
    // Запасной расчёт — без `signature`. Так считают некоторые библиотеки,
    // и так считал этот файл до сегодняшнего дня. Он оставлен не из
    // нерешительности: обе строки одинаково требуют знания токена бота,
    // то есть замок от этого не слабее ни на бит, — а цена ошибки
    // несимметрична. Ошибись мы в другую сторону, и починка снова
    // пойдёт через «Кирилл не может войти» и день ожидания, потому что
    // настоящую подпись Telegram здесь не подделать и не проверить.
    ok = matches(sorted.filter(([k]) => k !== "hash" && k !== "signature").map(([k, v]) => `${k}=${v}`).join("\n"));
  }
  if (!ok) return { ok: false, error: "Подпись не сходится", fields: sorted.map(([k]) => k) };

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
