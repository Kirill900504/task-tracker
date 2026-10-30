import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotChannelConfig } from "@/lib/botTransport";
import { hashedKey } from "@/lib/clientKey";
import { ownerChats, sendToColleague } from "@/lib/botDelivery";
import { withoutSelfMark } from "@/lib/actorName";

// Что проверяется, прежде чем код подключения сделает чат человеком
// (botPipeline.handleLinkCode). Аудит входа 30.10.2026: привязка чата и
// есть вход — кабинет заводится из неё сам (lib/cabinet), — поэтому каждая
// лазейка здесь означает чужой аккаунт целиком, а не чужие уведомления.

type PersonChats = { telegram_chat_id: number | null; max_user_id: number | null };

// Приглашение «всё в одном» живёт неделю и подходит обоим ботам, а
// «Пригласить всех» раздаёт такие ссылки пачкой. До 30.10.2026 код не
// сгорал и после подключения: человек подключил MAX, а любой, у кого
// оказалась его ссылка (общий чат, пересланное сообщение), подключал к нему
// СВОЙ Telegram — и входил в трекер под его именем. Теперь ссылка
// подключает только ПЕРВЫЙ мессенджер; второй человек добавляет сам из
// «Личного кабинета», где код выписывается уже вошедшему.
export function welcomeRefusal(person: PersonChats, channel: BotChannelConfig, chatId: number): string | null {
  const here = person[channel.chatColumn];
  if (here && Number(here) === Number(chatId)) return null;
  if (here) {
    return `Этот человек уже подключён к ${channel.label} с другого аккаунта. Если это вы и аккаунт новый — попросите у Кирилла новую ссылку.`;
  }
  const other = channel.chatColumn === "telegram_chat_id" ? person.max_user_id : person.telegram_chat_id;
  if (other) {
    return (
      "По этой ссылке уже подключились. Второй мессенджер добавляется из трекера: " +
      "своё имя вверху → «Личный кабинет» → «Подключить». Так его не подключит тот, кому ссылка попала случайно."
    );
  }
  return null;
}

// Один аккаунт мессенджера — один человек. Чат, привязанный к двум строкам
// людей, отдавал мини-приложению и входу через бота ту, что база вернула
// первой (`limit(1)`), — то есть открыв ссылку коллеги «посмотреть, как
// выглядит», можно было начать входить в трекер им. Тем же путём владелец,
// проверявший чужое приглашение со своего телефона, становился этим
// человеком в боте.
export async function chatTakenBy(
  admin: SupabaseClient,
  channel: BotChannelConfig,
  chatId: number,
  assigneeId: string | null,
): Promise<string | null> {
  const [{ data: rows }, { data: account }] = await Promise.all([
    admin.from("assignees").select("id, name").eq(channel.chatColumn, chatId).is("archived_at", null).limit(5),
    admin.from(channel.accountsTable).select("user_id").eq(channel.chatColumn, chatId).limit(1).maybeSingle(),
  ]);
  const other = ((rows || []) as { id: string; name: string }[]).find((r) => r.id !== assigneeId);
  if (other) return withoutSelfMark(other.name);
  // Чат владельца пространства (его вход живёт в таблице аккаунтов) — к
  // строке другого человека он не привязывается.
  if (assigneeId && account) return "владелец трекера";
  return null;
}

export function takenText(channel: BotChannelConfig, name: string): string {
  return (
    `Этот аккаунт ${channel.label} уже подключён к трекеру как «${name}». ` +
    "Один аккаунт мессенджера — один человек: откройте ссылку со своего аккаунта."
  );
}

// Подбор кодов из чата: код можно прислать текстом, и до 30.10.2026 попыток
// было сколько угодно. Десять промахов за час — дальше отказ.
const MISSES = 10;
const MISS_WINDOW_S = 3600;

function chatKey(channel: BotChannelConfig, chatId: number): string {
  return hashedKey(`link:${channel.id}:${chatId}`);
}

export async function tooManyMisses(admin: SupabaseClient, channel: BotChannelConfig, chatId: number): Promise<boolean> {
  const since = new Date(Date.now() - MISS_WINDOW_S * 1000).toISOString();
  const { count } = await admin
    .from("api_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", chatKey(channel, chatId))
    .eq("route", "link-code-miss")
    .gte("created_at", since);
  return (count ?? 0) >= MISSES;
}

export async function recordMiss(admin: SupabaseClient, channel: BotChannelConfig, chatId: number): Promise<void> {
  await admin.from("api_rate_limits").insert({ user_id: chatKey(channel, chatId), route: "link-code-miss" });
}

// Подключился человек — владелец пространства узнаёт об этом сразу, с
// именем аккаунта в мессенджере. Подключение по чужой ссылке иначе
// невидимо: у настоящего человека «не подключён» просто сменилось бы на
// «на связи», и никто бы не спросил, кто там на самом деле.
export async function tellInviter(
  admin: SupabaseClient,
  spaceId: string,
  name: string,
  channel: BotChannelConfig,
  username: string | null,
): Promise<void> {
  const chat = (await ownerChats(admin, spaceId).catch(() => []))[0];
  if (!chat) return;
  const who = username ? ` (@${username.replace(/^@/, "")})` : "";
  await sendToColleague(
    chat,
    `🔗 ${withoutSelfMark(name)} подключил(а) ${channel.label}${who}.\n\n` +
      "Если это не он(а) — отвяжите мессенджер в «Команде» (⋮ у имени) и пришлите человеку новую ссылку лично.",
  ).catch(() => undefined);
}
