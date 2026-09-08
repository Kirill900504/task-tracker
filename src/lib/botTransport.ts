// One shape for "a messenger the tracker can talk to".
//
// The bot's behaviour — what a message means, what gets created, what is
// asked back — is the same whether it arrives from Telegram or from MAX (see
// botPipeline.ts). What differs is only how a message is sent, how a pressed
// button is acknowledged, and which table remembers whose chat this is. That
// difference lives behind these two types and nowhere else.

export type BotButton = { text: string; data: string };
export type BotSendResult = { ok: boolean; error?: string; messageId?: string };

export type BotTransport = {
  // Also the rate-limit key and the source recorded in the AI action log.
  channel: "telegram" | "max";
  // How the messenger is named to the person reading the reply.
  label: string;
  send(chatId: number, text: string, options?: { buttons?: BotButton[][] }): Promise<BotSendResult>;
  // A pressed button, answered: a short toast where the messenger has them,
  // and the message rewritten to say what happened, so buttons that no
  // longer do anything stop being offered.
  resolveCallback(input: {
    callbackId: string;
    chatId: number;
    messageId?: string;
    toast: string;
    rewriteTo?: string;
  }): Promise<void>;
};

// Which tables and columns remember a chat for this messenger. Passing this
// around beats a boolean: the queries read the same either way, and adding a
// third messenger is a new constant rather than a new branch.
export type BotChannelConfig = {
  id: "telegram" | "max";
  label: string;
  accountsTable: "telegram_accounts" | "max_accounts";
  // The chat/user id column, both in the accounts table and on `assignees`.
  chatColumn: "telegram_chat_id" | "max_user_id";
  usernameColumn: "telegram_username" | "max_username";
  linkedAtColumn: "linked_at" | "max_linked_at";
};

export const TELEGRAM_CHANNEL: BotChannelConfig = {
  id: "telegram",
  label: "Telegram",
  accountsTable: "telegram_accounts",
  chatColumn: "telegram_chat_id",
  usernameColumn: "telegram_username",
  linkedAtColumn: "linked_at",
};

export const MAX_CHANNEL: BotChannelConfig = {
  id: "max",
  label: "MAX",
  accountsTable: "max_accounts",
  chatColumn: "max_user_id",
  usernameColumn: "max_username",
  linkedAtColumn: "max_linked_at",
};

export const BOT_CHANNELS: BotChannelConfig[] = [TELEGRAM_CHANNEL, MAX_CHANNEL];

export function channelById(id: string): BotChannelConfig | null {
  return BOT_CHANNELS.find((c) => c.id === id) ?? null;
}
