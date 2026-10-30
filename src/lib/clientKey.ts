import { createHash } from "node:crypto";

// Ключ «этого устройства» для предела частоты на ПУБЛИЧНЫХ маршрутах —
// там, где входа ещё нет и считать по человеку нельзя.
//
// Считаем по адресу, с которого пришёл запрос: его ставит прокси Vercel
// (`x-real-ip`, иначе первый адрес `x-forwarded-for`), подделать его
// снаружи нельзя — Vercel переписывает оба заголовка сам. Сам адрес не
// хранится: в таблицу пределов (`api_rate_limits.user_id`, uuid без
// внешнего ключа) ложится хеш с секретом сервера, оформленный как uuid, —
// по нему нельзя восстановить, кто и откуда входил.
//
// Зачем (30.10.2026): у «Войти через мессенджер» до этого был только ОБЩИЙ
// предел на всех, и скрипт, исчерпав его, на несколько минут отнимал
// кнопку у каждого. Предел по адресу отсекает скрипт и не трогает
// остальных; общий остаётся последней страховкой с большим запасом.
// Тот же хеш для любого другого «кто это» без учётной записи — например,
// чата мессенджера, который подбирает коды подключения (lib/linkGuard).
export function hashedKey(text: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY || "rokas";
  const hex = createHash("sha256").update(`client-key-v1:${salt}:${text}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function clientKeyOf(req: Request): string | null {
  const ip =
    (req.headers.get("x-real-ip") || "").trim() ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (!ip) return null;
  return hashedKey(ip);
}
