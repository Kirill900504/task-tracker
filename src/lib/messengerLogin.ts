import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotChannelConfig } from "@/lib/botTransport";
import { findColleagueByChat, findOwnerSelfByChat } from "@/lib/colleagues";
import { ensureCabinet } from "@/lib/cabinet";

// Вход на компьютере через мессенджер, без пароля (28.10.2026).
//
// Подключённый бот давно и есть вход (lib/cabinet): мини-приложение открывает
// трекер по подписи мессенджера. Но на КОМПЬЮТЕРЕ — в настольном приложении и
// в браузере — человек упирался в форму «почта и пароль», которых у него нет:
// кабинет из мессенджера заводится на служебной почте. Ссылка «💻 Вход с
// компьютера» из бота открывается в системном браузере, а не в окне
// приложения, — то есть до самого приложения она не доводила никогда.
//
// Поэтому вход устроен как у телевизоров и Telegram Web: окно заводит
// запрос (login_requests, миграция 0069) и показывает кнопку на бота с его
// токеном; человек жмёт в боте «Да, это я»; бот кладёт в запрос одноразовый
// код; окно, которое всё это время спрашивало «ну что?», меняет код на
// сессию у себя. Вход случается там, где его ждут, а не в соседней вкладке.
//
// Подтверждение кнопкой — не формальность. Ссылку с чужим токеном можно
// подсунуть человеку («нажми Start»), и без вопроса «это вы входите?» вход
// достался бы тому, кто ссылку прислал.

export const LOGIN_PREFIX = "LOGIN";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newLoginToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = LOGIN_PREFIX;
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function isLoginToken(value: string): boolean {
  return new RegExp(`^${LOGIN_PREFIX}[${ALPHABET}]{20}$`).test(value);
}

// Кто этот чат — человек из списка или владелец (у него чат на учётной
// записи, а не на строке; см. lib/reach).
async function personOfChat(admin: SupabaseClient, chatId: number, channel: BotChannelConfig) {
  return (await findColleagueByChat(admin, chatId, channel)) || (await findOwnerSelfByChat(admin, chatId, channel));
}

export type LoginPrompt = { text: string; buttons?: { text: string; data: string }[][] };

// Ответ бота на /start LOGIN…: вопрос с двумя кнопками.
export async function loginPrompt(admin: SupabaseClient, chatId: number, channel: BotChannelConfig, token: string): Promise<LoginPrompt> {
  const { data: request } = await admin.from("login_requests").select("expires_at, approved_at").eq("token", token).maybeSingle();
  if (!request || new Date(request.expires_at as string).getTime() < Date.now()) {
    return { text: "Эта кнопка входа устарела. Нажмите «Войти через " + channel.label + "» на странице входа ещё раз." };
  }
  const person = await personOfChat(admin, chatId, channel);
  if (!person) {
    return { text: "Этот чат ещё не подключён к трекеру. Откройте ссылку-приглашение, которую вам прислали, и нажмите «Start» оттуда." };
  }
  return {
    text:
      "💻 Вход в трекер на компьютере.\n\n" +
      "Это вы сейчас входите? Если вы ничего не открывали — нажмите «Нет»: значит, ссылку вам прислал кто-то другой.",
    buttons: [
      [
        { text: "✅ Да, войти", data: `t:lgok:${token}` },
        { text: "✖ Нет", data: `t:lgno:${token}` },
      ],
    ],
  };
}

export function isLoginAction(action: { kind: string; action: string }): boolean {
  return action.kind === "task" && (action.action === "lgok" || action.action === "lgno");
}

// Нажатие «Да» или «Нет». Возвращает текст, которым переписать вопрос.
export async function resolveLogin(
  admin: SupabaseClient,
  chatId: number,
  channel: BotChannelConfig,
  token: string,
  yes: boolean,
): Promise<string> {
  const { data: request } = await admin.from("login_requests").select("expires_at, approved_at, refused_at").eq("token", token).maybeSingle();
  if (!request || new Date(request.expires_at as string).getTime() < Date.now()) return "Эта кнопка входа устарела — начните вход на компьютере заново.";
  if (request.approved_at || request.refused_at) return "Уже отвечено.";
  if (!yes) {
    await admin.from("login_requests").update({ refused_at: new Date().toISOString() }).eq("token", token);
    return "✖ Вход отклонён. Если вы ничего не открывали — ничего делать не нужно, без вашей кнопки в трекер не войти.";
  }

  const person = await personOfChat(admin, chatId, channel);
  if (!person) return "Этот чат не подключён к трекеру.";
  const cabinet = await ensureCabinet(admin, person.id);
  if (!cabinet.ok) return cabinet.error;
  const { data: user } = await admin.auth.admin.getUserById(cabinet.authId);
  const email = user?.user?.email;
  if (!email) return "Не получилось собрать вход — скажите об этом Кириллу.";
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (error || !tokenHash) return "Не получилось собрать вход — попробуйте ещё раз.";

  // Условие на approved_at — от двойного нажатия: второй ответ не
  // перепишет уже выданный код.
  await admin
    .from("login_requests")
    .update({ approved_at: new Date().toISOString(), token_hash: tokenHash })
    .eq("token", token)
    .is("approved_at", null);
  return "✅ Готово — трекер на компьютере открывается.";
}
