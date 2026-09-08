import type { BotTransport } from "@/lib/botTransport";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

// One row of the buttons attached under a message. Telegram calls these
// inline keyboards; pressing one sends `callback_data` back to the webhook
// without the person having to type anything.
export type InlineButton = { text: string; callback_data: string };
export type SendResult = { ok: boolean; error?: string; messageId?: number };

// The result matters when writing to a COLLEAGUE: they may never have
// started the bot, or may have blocked it, and the person who pressed
// «Отправить» has to be told rather than left assuming it arrived. For the
// owner's own chat the result is simply ignored, as before.
export async function sendTelegramMessage(
  chatId: number,
  text: string,
  options?: { buttons?: InlineButton[][] },
): Promise<SendResult> {
  try {
    const res = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(options?.buttons ? { reply_markup: { inline_keyboard: options.buttons } } : {}),
      }),
    });
    const body = await res.json().catch(() => null);
    if (!body?.ok) return { ok: false, error: body?.description || `HTTP ${res.status}` };
    return { ok: true, messageId: body.result?.message_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Every button press must be acknowledged, or Telegram leaves a spinner on
// it for the person who tapped.
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  try {
    await fetch(`${API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
    });
  } catch {
    /* the answer is a courtesy; the action itself has already happened */
  }
}

// After a button is used, the message is rewritten to say what happened —
// so the chat shows the outcome instead of buttons that now do nothing.
export async function editTelegramMessage(
  chatId: number,
  messageId: number,
  text: string,
  options?: { buttons?: InlineButton[][] },
): Promise<void> {
  try {
    await fetch(`${API}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: { inline_keyboard: options?.buttons ?? [] },
      }),
    });
  } catch {
    /* cosmetic */
  }
}

export async function sendTelegramDocument(chatId: number, filename: string, content: string, caption?: string) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([content], { type: "application/json" }), filename);
  await fetch(`${API}/sendDocument`, { method: "POST", body: form });
}

// Telegram only gives webhooks a file_id — the actual bytes live on
// Telegram's file servers and need a second round-trip to fetch.
export async function downloadTelegramFile(fileId: string): Promise<ArrayBuffer> {
  const infoRes = await fetch(`${API}/getFile?file_id=${fileId}`);
  const info = await infoRes.json();
  const path = info?.result?.file_path;
  if (!path) throw new Error("Telegram getFile: " + JSON.stringify(info));
  const fileRes = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${path}`);
  return fileRes.arrayBuffer();
}

// The Telegram side of the shared bot interface (see botTransport.ts). The
// functions above stay as they are — this only translates the neutral shapes
// into Telegram's own.
export function telegramTransport(): BotTransport {
  return {
    channel: "telegram",
    label: "Telegram",
    async send(chatId, text, options) {
      const buttons = options?.buttons?.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data })));
      const result = await sendTelegramMessage(chatId, text, buttons?.length ? { buttons } : undefined);
      return { ok: result.ok, error: result.error, messageId: result.messageId != null ? String(result.messageId) : undefined };
    },
    async resolveCallback({ callbackId, chatId, messageId, toast, rewriteTo }) {
      await answerCallbackQuery(callbackId, toast);
      if (rewriteTo && messageId) await editTelegramMessage(chatId, Number(messageId), rewriteTo);
    },
  };
}
