import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton, BotChannelConfig, BotSendResult, BotTransport } from "@/lib/botTransport";
import { BOT_CHANNELS, MAX_CHANNEL, TELEGRAM_CHANNEL } from "@/lib/botTransport";
import { telegramTransport } from "@/lib/telegram";
import { maxTransport, maxConfigured } from "@/lib/max";
import { chatsFor, type ColleagueRow } from "@/lib/colleagues";
import { queueNotice, type Notice } from "@/lib/noticeQueue";

// Where a message actually goes.
//
// The owner may be connected to both messengers, one, or (after a fresh
// install) neither, and the same is true of every colleague. Rather than
// every caller asking "Telegram or MAX?", they say who and what, and this
// answers it from the database.

export function transportFor(channel: BotChannelConfig): BotTransport {
  return channel.id === "max" ? maxTransport() : telegramTransport();
}

// Only the messengers that are actually set up. Telegram's token is an
// environment variable; MAX's is a row in the database the owner filled in
// himself (see botSettings.ts), which is why this has to be asked rather
// than read.
export async function activeChannels(): Promise<BotChannelConfig[]> {
  const max = await maxConfigured();
  return BOT_CHANNELS.filter((c) => (c.id === "max" ? max : !!process.env.TELEGRAM_BOT_TOKEN));
}

export type OwnerChat = { channel: BotChannelConfig; chatId: number };

export async function ownerChats(admin: SupabaseClient, userId: string): Promise<OwnerChat[]> {
  const out: OwnerChat[] = [];
  for (const channel of await activeChannels()) {
    const { data } = await admin.from(channel.accountsTable).select(channel.chatColumn).eq("user_id", userId).limit(1).maybeSingle();
    const chatId = (data as Record<string, number> | null)?.[channel.chatColumn];
    if (chatId != null) out.push({ channel, chatId });
  }
  return out;
}

// The owner hears about something (a colleague pressed a button, a reminder
// came due) in every messenger he has connected — he reads whichever is open.
export async function notifyOwner(admin: SupabaseClient, userId: string, text: string): Promise<number> {
  const chats = await ownerChats(admin, userId);
  for (const chat of chats) {
    await transportFor(chat.channel).send(chat.chatId, text);
  }
  return chats.length;
}

// Тому, кто поручил, — а не всегда владельцу.
//
// Правило записано в docs/multiuser.md как «петля должна замыкаться»:
// отчитался — постановщик должен узнать. До сих пор каждый ответ уходил
// владельцу пространства независимо от того, кто задачу поставил. Пока
// ставил только Кирилл, разницы не было; как только руководитель поставит
// задачу другому, автор не узнает об отчёте вовсе — а Кирилл получит
// четырнадцать чужих переписок и выключит уведомления.
//
// Владелец остаётся получателем всего, что поставил сам, и по-прежнему
// видит всё в трекере и в понедельничной сводке.
export async function notifyAuthor(
  admin: SupabaseClient,
  ownerId: string,
  createdBy: string | null,
  text: string,
  // Вид события. Есть — строка идёт в очередь и выйдет одним письмом со
  // своими соседями (см. noticeQueue и правило ниже); нет — уходит сразу,
  // как уходило всегда.
  //
  // Почему так: постановщику за день приходит десяток сообщений от
  // четырнадцати человек, и сплошной лентой их перестают читать целиком —
  // вместе с «не могу» и «просрочено», ради которых всё затевалось.
  // Исполнителю, наоборот, всё уходит сразу: там ждут ответа от него, и
  // задержка стоит дороже порядка.
  notice?: Notice,
): Promise<void> {
  if (notice) {
    const to = !createdBy || createdBy === ownerId ? null : createdBy;
    // Очередь может быть недоступна (миграция ещё не применена) — тогда
    // сообщение уходит по-старому, а не теряется.
    if (await queueNotice(admin, ownerId, to, notice)) return;
  }

  if (!createdBy || createdBy === ownerId) {
    await notifyOwner(admin, ownerId, text);
    return;
  }

  // Автор — руководитель: писать ему надо в тот чат, куда ходят его задачи,
  // то есть в строку человека, а не в аккаунт владельца.
  const { data: member } = await admin
    .from("workspace_members")
    .select("assignee_id")
    .eq("member_id", createdBy)
    .eq("owner_id", ownerId)
    .maybeSingle();
  const assigneeId = (member as { assignee_id?: string } | null)?.assignee_id;
  if (!assigneeId) {
    // Автора не нашли — молчать хуже, чем сказать не тому: владелец всё
    // равно отвечает за пространство.
    await notifyOwner(admin, ownerId, text);
    return;
  }

  const { data: person } = await admin
    .from("assignees")
    .select("id, name, telegram_chat_id, telegram_username, max_user_id, max_username")
    .eq("id", assigneeId)
    .maybeSingle();
  const target = person ? chatsFor(person as ColleagueRow)[0] : undefined;
  if (target) await sendToColleague(target, text);
}

// Writing to a colleague: one message, through the messenger they connected
// through (see chatsFor for why the first one wins).
export async function sendToColleague(
  target: { channel: BotChannelConfig; chatId: number },
  text: string,
  buttons?: BotButton[][],
): Promise<BotSendResult> {
  return transportFor(target.channel).send(target.chatId, text, buttons?.length ? { buttons } : undefined);
}

export { TELEGRAM_CHANNEL, MAX_CHANNEL };
