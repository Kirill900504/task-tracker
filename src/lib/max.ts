import type { BotButton, BotSendResult, BotTransport } from "@/lib/botTransport";

// MAX (max.ru) Bot API.
//
// The same job telegram.ts does, against a different API:
//   * base https://platform-api2.max.ru, token in the `Authorization` header
//     (query-string tokens are no longer accepted);
//   * a private conversation is addressed by the person's user_id, not by a
//     chat id — POST /messages?user_id=...;
//   * buttons are an `inline_keyboard` ATTACHMENT rather than a reply markup,
//     and carry `payload` where Telegram carries callback_data;
//   * a pressed button is answered with POST /answers?callback_id=..., which
//     replaces the message rather than showing a toast.
//
// Everything is best-effort in the same way as the Telegram side: a failed
// send is reported back (a colleague has to be told their message did not
// arrive), a failed cosmetic edit is swallowed.

const API = "https://platform-api2.max.ru";
// MAX rejects a message over 4000 characters outright; Telegram's limit is
// 4096, so a brief that fits there can still be too long here.
const MAX_TEXT = 4000;

function token(): string {
  return process.env.MAX_BOT_TOKEN || "";
}

export function maxConfigured(): boolean {
  return !!token();
}

function headers(): Record<string, string> {
  return { Authorization: token(), "Content-Type": "application/json" };
}

function keyboardAttachment(buttons: BotButton[][]) {
  return {
    type: "inline_keyboard",
    payload: {
      buttons: buttons.map((row) => row.map((b) => ({ type: "callback", text: b.text, payload: b.data }))),
    },
  };
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 1) + "…" : text;
}

async function errorText(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.message || body?.error || `HTTP ${res.status}`;
}

export async function sendMaxMessage(userId: number, text: string, options?: { buttons?: BotButton[][] }): Promise<BotSendResult> {
  if (!maxConfigured()) return { ok: false, error: "MAX не подключён" };
  try {
    const res = await fetch(`${API}/messages?user_id=${userId}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        text: clip(text),
        ...(options?.buttons?.length ? { attachments: [keyboardAttachment(options.buttons)] } : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: await errorText(res) };
    const body = await res.json().catch(() => null);
    return { ok: true, messageId: body?.message?.body?.mid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function editMaxMessage(messageId: string, text: string): Promise<void> {
  if (!maxConfigured()) return;
  try {
    await fetch(`${API}/messages?message_id=${encodeURIComponent(messageId)}`, {
      method: "PUT",
      headers: headers(),
      // An empty attachment list is what removes the buttons — the point of
      // the rewrite is that they stop being offered.
      body: JSON.stringify({ text: clip(text), attachments: [] }),
    });
  } catch {
    /* cosmetic */
  }
}

// MAX has no toast of its own: answering a callback either replaces the
// message or does nothing visible. So the outcome is written into the
// message where there is one to write, and sent as a plain reply otherwise.
export async function answerMaxCallback(callbackId: string, replacementText?: string): Promise<void> {
  if (!maxConfigured()) return;
  try {
    await fetch(`${API}/answers?callback_id=${encodeURIComponent(callbackId)}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(replacementText ? { message: { text: clip(replacementText), attachments: [] } } : {}),
    });
  } catch {
    /* the action itself has already happened */
  }
}

export function maxTransport(): BotTransport {
  return {
    channel: "max",
    label: "MAX",
    send: (chatId, text, options) => sendMaxMessage(chatId, text, options),
    async resolveCallback({ callbackId, chatId, toast, rewriteTo }) {
      // One call where the message can carry the outcome; a separate line in
      // the chat where it cannot, so a press is never silent.
      if (rewriteTo) {
        await answerMaxCallback(callbackId, rewriteTo);
        return;
      }
      await answerMaxCallback(callbackId);
      if (toast) await sendMaxMessage(chatId, toast);
    },
  };
}

// Used by scripts/max-setup.mjs equivalents and by the setup route: tells
// MAX where to deliver updates, and with which secret header.
export async function subscribeMaxWebhook(url: string, secret: string, updateTypes: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!maxConfigured()) return { ok: false, error: "MAX_BOT_TOKEN не задан" };
  try {
    const res = await fetch(`${API}/subscriptions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ url, update_types: updateTypes, secret }),
    });
    if (!res.ok) return { ok: false, error: await errorText(res) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
