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

// Число для сверки (30.10.2026): его показывает экран входа, а в чате
// оно стоит среди трёх кнопок. Запрос теперь приходит в чат сам — по
// фамилии или почте, которые может ввести кто угодно, — и вопрос «это
// вы?» с кнопкой «Да» стал бы входом для любого, кто знает чужой номер:
// привычное «да» нажимают не читая. Число с экрана знает только тот, кто
// этот экран видит.
export function newLoginCode(): number {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return 10 + (bytes[0] % 90);
}

// Три числа: верное и два других, в случайном порядке.
export function codeChoices(code: number): number[] {
  const out = [code];
  while (out.length < 3) {
    const n = newLoginCode();
    if (!out.includes(n)) out.push(n);
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = newLoginCode() % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Устройство словами — из заголовка браузера, без версий: «Chrome · Windows».
// Его и время видит человек в вопросе (аудит 30.10.2026): «новое
// устройство» без подробностей не отличить от своего, а под вопросом три
// числа, и нажатое наугад из любопытства верно в одном случае из трёх.
export function deviceOf(userAgent: string | null | undefined): string {
  const ua = userAgent || "";
  if (!ua) return "";
  const browser = /Electron\//.test(ua)
    ? "приложение для ПК"
    : /Edg\//.test(ua)
      ? "Edge"
      : /YaBrowser\//.test(ua)
        ? "Яндекс Браузер"
        : /OPR\//.test(ua)
          ? "Opera"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Chrome\//.test(ua)
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : "";
  const system = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return [browser, system].filter(Boolean).join(" · ");
}

export function loginPromptText(device?: string | null, at: Date = new Date()): string {
  const when = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(at);
  return (
    `💻 Вход в трекер на новом устройстве${device ? ` (${device})` : ""}, ${when} МСК.\n\n` +
    "Если входите вы — нажмите число, которое видите на экране входа.\n" +
    "Если вы сейчас ничего не открывали — нажмите «Это не я» и не выбирайте число наугад. " +
    "Никому не называйте это число и не нажимайте его по чьей-то просьбе."
  );
}

export const LOGIN_PROMPT_TEXT = loginPromptText();

// Запрос без числа — заведённый до 30.10.2026 — отвечается прежним «Да».
export function loginButtons(token: string, code: number | null): { text: string; data: string }[][] {
  if (code == null) {
    return [
      [
        { text: "✅ Да, войти", data: `t:lgok:${token}` },
        { text: "✖ Нет", data: `t:lgno:${token}` },
      ],
    ];
  }
  return [
    codeChoices(code).map((n) => ({ text: String(n), data: `t:lgok:${token}.${n}` })),
    [{ text: "✖ Это не я", data: `t:lgno:${token}` }],
  ];
}

// Ответ бота на /start LOGIN…: тот же вопрос, что приходит сам.
export async function loginPrompt(admin: SupabaseClient, chatId: number, channel: BotChannelConfig, token: string): Promise<LoginPrompt> {
  const { data: request } = await admin.from("login_requests").select("expires_at, approved_at, code, device").eq("token", token).maybeSingle();
  if (!request || new Date(request.expires_at as string).getTime() < Date.now()) {
    return { text: "Эта кнопка входа устарела. Нажмите «Войти через " + channel.label + "» на странице входа ещё раз." };
  }
  const person = await personOfChat(admin, chatId, channel);
  if (!person) {
    return { text: "Этот чат ещё не подключён к трекеру. Откройте ссылку-приглашение, которую вам прислали, и нажмите «Start» оттуда." };
  }
  return { text: loginPromptText(request.device as string | null), buttons: loginButtons(token, (request.code as number | null) ?? null) };
}

// Отказ («Это не я» или не то число) на час закрывает присылку вопросов
// этому человеку (lib/loginPush). Без этого чужой мог присылать вопрос раз
// за разом — пять раз за десять минут, — пока одно из нажатий наугад не
// попадёт в верное число. Сам человек входит, как и прежде: ссылкой на
// бота со страницы входа, где вопрос он открывает себе сам.
export const REFUSAL_ROUTE = "login-refused";
export const REFUSAL_WINDOW_S = 3600;

async function noteRefusal(admin: SupabaseClient, assigneeId: string): Promise<void> {
  await admin.from("api_rate_limits").insert({ user_id: assigneeId, route: REFUSAL_ROUTE });
}

export function isLoginAction(action: { kind: string; action: string }): boolean {
  return action.kind === "task" && (action.action === "lgok" || action.action === "lgno");
}

// Нажатие «Да» или «Нет». Возвращает текст, которым переписать вопрос.
export async function resolveLogin(
  admin: SupabaseClient,
  chatId: number,
  channel: BotChannelConfig,
  id: string,
  yes: boolean,
): Promise<string> {
  // id кнопки — «ТОКЕН» или «ТОКЕН.число» (см. loginButtons).
  const [token, picked] = id.split(".");
  const { data: request } = await admin
    .from("login_requests")
    .select("expires_at, approved_at, refused_at, code")
    .eq("token", token)
    .maybeSingle();
  if (!request || new Date(request.expires_at as string).getTime() < Date.now()) return "Эта кнопка входа устарела — начните вход на компьютере заново.";
  if (request.approved_at || request.refused_at) return "Уже отвечено.";
  const person = await personOfChat(admin, chatId, channel);
  if (!yes) {
    await admin.from("login_requests").update({ refused_at: new Date().toISOString() }).eq("token", token);
    if (person) await noteRefusal(admin, person.id);
    return "✖ Вход отклонён. Если вы ничего не открывали — ничего делать не нужно: без вашего нажатия в трекер не войти. Час такие запросы вам приходить не будут.";
  }
  // Не то число — отказ, а не «попробуйте ещё»: перебирать три кнопки по
  // кругу нельзя, а настоящий хозяин просто начнёт вход заново.
  if (request.code != null && Number(picked) !== request.code) {
    await admin.from("login_requests").update({ refused_at: new Date().toISOString() }).eq("token", token).is("approved_at", null);
    if (person) await noteRefusal(admin, person.id);
    return "✖ Число не совпало с экраном входа — вход отменён. Если входили вы — нажмите на странице входа «Открыть бота» и выберите число, которое видите на экране.";
  }

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
