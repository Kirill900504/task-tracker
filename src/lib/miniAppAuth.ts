import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotChannelConfig } from "@/lib/botTransport";
import { checkInitData } from "@/lib/telegramInitData";
import { checkRateLimit } from "@/lib/rateLimit";
import { ensureCabinet } from "@/lib/cabinet";

// Вход в трекер из мини-приложения — одинаковый для Telegram и MAX.
//
// Одна функция на оба по той же причине, что и botPipeline: разойдись эти
// две проверки, и один и тот же бот пускал бы в трекер по разным правилам,
// а правило здесь — кому выдать СЕССИЮ. Мессенджеры при этом отличаются
// ровно двумя вещами, и обе приходят аргументами: откуда берётся токен
// бота и в какой колонке лежит чат (BotChannelConfig).
//
// Подпись у них совпадает вплоть до строки «WebAppData» — MAX описывает
// тот же алгоритм, что Telegram (dev.max.ru, «Валидация данных»):
//   secret = HMAC_SHA256(key = "WebAppData", message = <токен бота>)
//   hash   = hex(HMAC_SHA256(secret, <пары key=value через \n, без hash>))
// Поэтому проверяет её одна `checkInitData`, а не две почти одинаковых.
//
// Зачем это всё. Кирилл 20.09.2026: «если люди вне офиса им не всегда
// будет кайф открывать приложения, а мессенджеры у них ОТКРЫТЫ ВСЕГДА».
// Пароль от трекера — та самая преграда: почта корпоративная, пароль задан
// один раз и забыт. Мессенджер уже знает, кто перед ним, и подтверждает
// это подписью, которую нельзя подделать, не зная токена бота.
//
// Чем это НЕ является: новым доступом. Сессия выдаётся только тому, чей
// чат привязан к строке в «Команде» — привязку выдаёт Кирилл, — и никогда
// тому, кому он доступ отключил. Учётной записи у такого человека может
// ещё не быть: тогда она заводится здесь же (lib/cabinet).

export type MiniAppResult =
  | { ok: true; tokenHash: string; email: string; same?: boolean }
  // `fields` — только имена полей, пришедших от мессенджера, и только
  // когда подпись не сошлась. Без них отказ ничего не объясняет, а
  // повторить настоящую подпись на нашей стороне нельзя.
  | { ok: false; status: number; error: string; fields?: string[] };

export async function miniAppSession(
  admin: SupabaseClient,
  channel: BotChannelConfig,
  botToken: string,
  initData: string,
  currentUserId: string | null = null,
): Promise<MiniAppResult> {
  const check = checkInitData(initData, botToken);
  if (!check.ok) return { ok: false, status: 401, error: check.error, fields: check.fields };

  const chatId = check.user.id;

  // Кто это в трекере. Порядок тот же, что у findActorByChat: сперва
  // владелец (его чат живёт в таблице аккаунтов), потом человек со входом
  // (его — на строке в списке людей плюс активное членство).
  const { data: account } = await admin
    .from(channel.accountsTable)
    .select("user_id")
    .eq(channel.chatColumn, chatId)
    .limit(1)
    .maybeSingle();
  let authId = (account as { user_id: string } | null)?.user_id || null;

  if (!authId) {
    const { data: person } = await admin
      .from("assignees")
      .select("id")
      .eq(channel.chatColumn, chatId)
      .limit(1)
      .maybeSingle();
    const assigneeId = (person as { id: string } | null)?.id;
    if (!assigneeId) {
      // Чат вовсе не привязан ни к кому в «Команде» — тут кабинета не
      // завести: неизвестно, чей он.
      return {
        ok: false,
        status: 403,
        error:
          "Этот чат ещё не подключён к трекеру. Откройте ссылку подключения, которую прислал Кирилл, " +
          "или нажмите «Подключить» в своём трекере — и возвращайтесь сюда.",
      };
    }
    // Чат привязан — значит, Кирилл этого человека в трекер уже позвал, и
    // кабинет заводится сам (lib/cabinet). Раньше здесь был отказ «нет
    // входа, попросите приглашение» — то есть второй круг через Кирилла.
    const cabinet = await ensureCabinet(admin, assigneeId);
    if (!cabinet.ok) return { ok: false, status: 403, error: cabinet.error };
    authId = cabinet.authId;
  }

  // Тот же человек уже вошёл в этом окне — новая сессия не нужна, и это
  // самый частый случай: мини-приложение открывают по десять раз на дню.
  // Раньше каждое открытие выписывало одноразовый код и меняло его на
  // сессию — два лишних полёта до Supabase перед первым кадром.
  if (currentUserId && currentUserId === authId) return { ok: true, same: true, tokenHash: "", email: "" };

  // Считаем по найденному входу, а не по чату: ограничиваем того, кому
  // выдаём сессию.
  const { allowed } = await checkRateLimit(admin, authId, "miniapp-auth", 20, 300);
  if (!allowed) return { ok: false, status: 429, error: "Слишком много попыток подряд, подождите минуту" };

  const { data: user, error: userError } = await admin.auth.admin.getUserById(authId);
  const email = user?.user?.email;
  if (userError || !email) {
    return { ok: false, status: 500, error: "Не нашёл почту этого входа — напишите Кириллу" };
  }

  // Сессия выдаётся тем же путём, что и «Забыли пароль?»: одноразовый
  // код, который браузер меняет на сессию через verifyOtp. Готовую ссылку
  // Supabase здесь не берут — она уехала бы на чужой Site URL, см.
  // lib/recoveryLink.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link?.properties?.hashed_token) {
    return {
      ok: false,
      status: 500,
      error: "Не получилось войти: " + (linkError?.message || "Supabase не отдал одноразовый код"),
    };
  }

  return { ok: true, tokenHash: link.properties.hashed_token, email };
}
