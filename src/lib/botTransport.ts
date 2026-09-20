// One shape for "a messenger the tracker can talk to".
//
// The bot's behaviour — what a message means, what gets created, what is
// asked back — is the same whether it arrives from Telegram or from MAX (see
// botPipeline.ts). What differs is only how a message is sent, how a pressed
// button is acknowledged, and which table remembers whose chat this is. That
// difference lives behind these two types and nowhere else.

// Кнопка под сообщением. Обычная возвращает боту своё `data` и разбирается
// как нажатие; кнопка с `app` вместо этого ОТКРЫВАЕТ трекер внутри
// мессенджера (мини-приложение), и боту не приходит ничего.
//
// `data` у неё всё равно есть, и это не формальность: если мессенджер
// мини-приложений не умеет — а MAX сегодня их не публикует без повторной
// модерации, — транспорт отправляет её как обычную, и нажатие получает
// внятный ответ вместо тишины.
export type BotButton = { text: string; data: string; app?: string };
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
    // Чем заменить кнопки переписанного сообщения. Пусто — снять их совсем:
    // так правильно там, где действие больше не повторить. Но ответ на
    // встречу повторить можно и нужно («передумать можно до начала» —
    // решение проекта), и снятые кнопки делали это решение недействующим.
    rewriteButtons?: BotButton[][];
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
