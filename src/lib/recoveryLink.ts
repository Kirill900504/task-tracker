import type { SupabaseClient } from "@supabase/supabase-js";

// Ссылка «задайте себе новый пароль» — одна на все способы её выдать.
//
// Способов два и станет больше: владелец берёт её в «Команде» для человека,
// потерявшего доступ, а человек может попросить её сам со страницы входа —
// тогда она уходит ему в мессенджер. Собирается она в обоих случаях
// одинаково, и именно поэтому живёт здесь: разойдись эти две сборки, и
// чинить пришлось бы дважды, второй раз — не зная, что первая уже чинена.
//
// Почему не `properties.action_link`, который Supabase отдаёт готовым: тот
// ведёт на `<проект>.supabase.co/auth/v1/verify?...&redirect_to=<наш адрес>`,
// и `redirect_to` в нём МОЛЧА заменяется на Site URL проекта, если наш адрес
// не внесён в список разрешённых в чужой панели. В этом проекте он не
// внесён: проверка 19.09.2026 вернула `redirect_to=http://localhost:3000` —
// то есть человек уехал бы на пустой localhost, и выглядело бы это как
// «ссылка не работает», а не как ненастроенная чужая панель.
//
// Поэтому наружу отдаётся адрес ТРЕКЕРА с одноразовым `token_hash`, а
// /reset-password меняет его на сессию сам (`verifyOtp`). Настраивать для
// этого ничего не нужно, и человек видит знакомый адрес.

export async function recoveryLink(
  admin: SupabaseClient,
  email: string,
  origin: string,
): Promise<{ link: string } | { error: string }> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data?.properties?.hashed_token) {
    return { error: error?.message || "Supabase не отдал одноразовый код" };
  }
  const base = origin.replace(/\/+$/, "");
  return { link: `${base}/reset-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}` };
}

// Ссылка «открыть трекер, не вводя пароль».
//
// Та же механика, что у восстановления, и намеренно в том же файле: обе
// собираются из `hashed_token`, обе ведут на НАШ домен, и разойтись им
// нельзя. Разница одна — тип: `magiclink` пускает внутрь сразу, а
// `recovery` высаживает на форму нового пароля.
//
// Зачем это понадобилось (22.09.2026). В MAX кнопки мини-приложения нет —
// её установка отправляет бота на повторную модерацию, и это решение
// Кирилла, — поэтому ссылка из чата открывается во ВНЕШНЕМ браузере
// телефона. Там нет ни подписи мессенджера, ни сессии: человек упирается
// в форму входа и корпоративный пароль, которого не помнит. То есть
// трекер, ради которого всё затевалось, для половины людей заканчивался
// на этом экране.
//
// Граница у ссылки ровно та же, что у мини-приложения: она открывает
// СУЩЕСТВУЮЩИЙ вход, а не заводит новый. Кому входа не давали — тому и
// ссылка не выдаётся; уходит она только в чат, уже привязанный к этому
// человеку владельцем, то есть туда же, куда и его задачи.
export async function signInLink(
  admin: SupabaseClient,
  email: string,
  origin: string,
): Promise<{ link: string } | { error: string }> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) {
    return { error: error?.message || "Supabase не отдал одноразовый код" };
  }
  const base = origin.replace(/\/+$/, "");
  return { link: `${base}/enter?token_hash=${encodeURIComponent(data.properties.hashed_token)}` };
}

// Адрес, который человек увидит в браузере. За прокси Vercel в request.url
// лежит внутренний адрес, поэтому спрашиваем заголовки.
export function originOf(req: Request): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  // Локальная машина по https не отвечает, а заголовка x-forwarded-proto на
  // ней нет — без этой оговорки ссылка, выданная на `npx next start`, ведёт
  // на https://localhost и не открывается вовсе.
  const local = !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const proto = req.headers.get("x-forwarded-proto") || (local ? "http" : "https");
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}
