import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotChannelConfig } from "@/lib/botTransport";
import { checkInitData } from "@/lib/telegramInitData";
import { checkRateLimit } from "@/lib/rateLimit";

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
// Чем это НЕ является: новым доступом. Сессия выдаётся только тому, у кого
// вход в трекер уже есть; человеку без учётной записи отвечаем словами.

export type MiniAppResult =
  | { ok: true; tokenHash: string; email: string }
  // `fields` — только имена полей, пришедших от мессенджера, и только
  // когда подпись не сошлась. Без них отказ ничего не объясняет, а
  // повторить настоящую подпись на нашей стороне нельзя.
  | { ok: false; status: number; error: string; fields?: string[] };

export async function miniAppSession(
  admin: SupabaseClient,
  channel: BotChannelConfig,
  botToken: string,
  initData: string,
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
    if (assigneeId) {
      const { data: member } = await admin
        .from("workspace_members")
        .select("member_id")
        .eq("assignee_id", assigneeId)
        .eq("status", "active")
        .maybeSingle();
      authId = (member as { member_id: string | null } | null)?.member_id || null;
    }
  }

  if (!authId) {
    // Два разных «нет», и разница человеку важна: чат может быть вовсе не
    // привязан, а может принадлежать тому, кому задачи только присылают.
    // Второе — не поломка и не недонастройка, а то, как трекер устроен, и
    // сказать об этом надо словами, а не пустым экраном в окне без
    // адресной строки.
    return {
      ok: false,
      status: 403,
      error:
        "У этого чата нет входа в трекер. Задачи и кнопки работают прямо здесь, в боте — напишите «меню». " +
        "Если нужен полный доступ, попросите Кирилла прислать приглашение.",
    };
  }

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
