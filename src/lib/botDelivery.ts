import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton, BotChannelConfig, BotSendResult, BotTransport } from "@/lib/botTransport";
import { BOT_CHANNELS, MAX_CHANNEL, TELEGRAM_CHANNEL } from "@/lib/botTransport";
import { telegramTransport } from "@/lib/telegram";
import { maxTransport, maxConfigured } from "@/lib/max";

// Where a message actually goes.
//
// The owner may be connected to both messengers, one, or (after a fresh
// install) neither, and the same is true of every colleague. Rather than
// every caller asking "Telegram or MAX?", they say who and what, and this
// answers it from the database.

export function transportFor(channel: BotChannelConfig): BotTransport {
  return channel.id === "max" ? maxTransport() : telegramTransport();
}

// Only the messengers that are actually set up — MAX needs a token, which
// needs a verified organisation profile on their partner platform, so an
// install without one simply has no MAX.
export function activeChannels(): BotChannelConfig[] {
  return BOT_CHANNELS.filter((c) => (c.id === "max" ? maxConfigured() : !!process.env.TELEGRAM_BOT_TOKEN));
}

export type OwnerChat = { channel: BotChannelConfig; chatId: number };

export async function ownerChats(admin: SupabaseClient, userId: string): Promise<OwnerChat[]> {
  const out: OwnerChat[] = [];
  for (const channel of activeChannels()) {
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
