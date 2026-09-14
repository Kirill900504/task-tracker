import type { BotButton, BotSendResult, BotTransport } from "@/lib/botTransport";
import { maxSettings } from "@/lib/botSettings";
import { russianFetch } from "@/lib/russianCa";

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
//     replaces the message rather than showing a toast;
//   * and `*.max.ru` is signed by the Russian Ministry of Digital
//     Development's root CA, which Node does not trust — hence russianFetch
//     rather than fetch. Without it every call here dies as «fetch failed»
//     on the server while working perfectly from a Russian laptop, which is
//     the most misleading shape a bug can have.
//
// Everything is best-effort in the same way as the Telegram side: a failed
// send is reported back (a colleague has to be told their message did not
// arrive), a failed cosmetic edit is swallowed.

const API = "https://platform-api2.max.ru";
// MAX rejects a message over 4000 characters outright; Telegram's limit is
// 4096, so a brief that fits there can still be too long here.
const MAX_TEXT = 4000;

// The token is not an environment variable any more — see botSettings.ts
// for why it lives in the database. That makes every call here async in the
// one place it was already async anyway.
export async function maxConfigured(): Promise<boolean> {
  return !!(await maxSettings());
}

function headers(token: string): Record<string, string> {
  return { Authorization: token, "Content-Type": "application/json" };
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

// Node's fetch collapses every network failure into the same two words —
// "fetch failed" — and hides the reason in `cause`. On the /max page those
// two words are the whole answer the owner gets, and they cannot tell a
// wrong token from a name that does not resolve, a refused connection or a
// timeout. So unwrap the cause and put its code in the message.
function networkError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as { cause?: unknown }).cause;
  if (!(cause instanceof Error)) return e.message;
  const code = (cause as { code?: string }).code;
  return `${e.message} — ${code ? code + ": " : ""}${cause.message}`;
}

export async function sendMaxMessage(userId: number, text: string, options?: { buttons?: BotButton[][] }): Promise<BotSendResult> {
  const settings = await maxSettings();
  if (!settings) return { ok: false, error: "MAX не подключён" };
  try {
    const res = await russianFetch(`${API}/messages?user_id=${userId}`, {
      method: "POST",
      headers: headers(settings.token),
      body: JSON.stringify({
        text: clip(text),
        ...(options?.buttons?.length ? { attachments: [keyboardAttachment(options.buttons)] } : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: await errorText(res) };
    const body = await res.json().catch(() => null);
    return { ok: true, messageId: body?.message?.body?.mid };
  } catch (e) {
    return { ok: false, error: networkError(e) };
  }
}

export async function editMaxMessage(messageId: string, text: string): Promise<void> {
  const settings = await maxSettings();
  if (!settings) return;
  try {
    await russianFetch(`${API}/messages?message_id=${encodeURIComponent(messageId)}`, {
      method: "PUT",
      headers: headers(settings.token),
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
  const settings = await maxSettings();
  if (!settings) return;
  try {
    await russianFetch(`${API}/answers?callback_id=${encodeURIComponent(callbackId)}`, {
      method: "POST",
      headers: headers(settings.token),
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

// Both of these take the token explicitly, because the one caller that
// matters — /api/max/setup — is checking a token that has not been stored
// yet. Storing first and asking MAX afterwards would leave a wrong token
// saved and the bot silently dead.

// Who this token belongs to. The answer is what the invite links are built
// from (max.ru/<username>?start=CODE), so a token that works but cannot say
// its own username is still not enough to connect anybody.
export async function maxBotInfo(token: string): Promise<{ ok: true; username: string; name: string } | { ok: false; error: string }> {
  try {
    const res = await russianFetch(`${API}/me`, { headers: headers(token) });
    if (!res.ok) return { ok: false, error: await errorText(res) };
    const body = (await res.json().catch(() => null)) as Record<string, string> | null;
    if (!body) return { ok: false, error: "MAX ответил пустотой" };
    return { ok: true, username: body.username || "", name: body.name || body.first_name || "" };
  } catch (e) {
    return { ok: false, error: networkError(e) };
  }
}

// Tells MAX where to deliver updates, and with which secret header.
export async function subscribeMaxWebhook(
  token: string,
  url: string,
  secret: string,
  updateTypes: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: "Токен MAX не задан" };
  try {
    const res = await russianFetch(`${API}/subscriptions`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ url, update_types: updateTypes, secret }),
    });
    if (!res.ok) return { ok: false, error: await errorText(res) };
    const body = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
    if (body?.success === false) return { ok: false, error: body.message || "MAX отклонил подписку" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: networkError(e) };
  }
}
