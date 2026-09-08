import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { maxConfigured, maxTransport } from "@/lib/max";
import { decodeCallback } from "@/lib/colleagues";
import { handleColleagueCallback } from "@/lib/colleagueReplies";
import { handleLinkCode, handleText, type BotContext } from "@/lib/botPipeline";
import { notifyOwner } from "@/lib/botDelivery";
import { MAX_CHANNEL } from "@/lib/botTransport";

// MAX's side of the bot. Everything past "what did this person say" is the
// same code the Telegram webhook runs — see botPipeline.ts.
//
// What is genuinely different here:
//   * a private conversation is addressed by the person's user_id, so that
//     is what identifies the chat everywhere (max_accounts.max_user_id);
//   * updates carry no id of their own, so the deduplication key is built
//     from the message id or the callback id;
//   * there is no /start with a payload — connecting arrives as a
//     `bot_started` update whose `payload` is the code from the link.

export const maxDuration = 60;

function dedupeKey(update: Record<string, unknown>): string | null {
  const type = String(update.update_type || "");
  if (type === "message_callback") {
    const callback = update.callback as { callback_id?: string } | undefined;
    return callback?.callback_id ? "cb:" + callback.callback_id : null;
  }
  if (type === "message_created") {
    const message = update.message as { body?: { mid?: string } } | undefined;
    return message?.body?.mid ? "msg:" + message.body.mid : null;
  }
  if (type === "bot_started") {
    const user = update.user as { user_id?: number } | undefined;
    return user?.user_id ? `start:${user.user_id}:${update.timestamp ?? ""}` : null;
  }
  return null;
}

// The bytes of a voice message, but only when they are actually OGG/Opus —
// that is the one container the transcriber can decode (see speechToText).
// Sniffing the file beats trusting the extension: an .m4a note would
// otherwise reach the decoder and fail deep inside WASM.
async function oggVoiceBytes(attachments: unknown): Promise<ArrayBuffer | null> {
  if (!Array.isArray(attachments)) return null;
  const audio = attachments.find((a) => a && typeof a === "object" && ["audio", "voice"].includes(String((a as { type?: string }).type)));
  const url = (audio as { payload?: { url?: string } } | undefined)?.payload?.url;
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    const head = new Uint8Array(bytes.slice(0, 4));
    const isOgg = head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53; // "OggS"
    return isOgg ? bytes : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  // Without a token there is no bot: MAX issues one only to a verified
  // organisation profile, so an install without that simply has no MAX, and
  // this endpoint must not pretend otherwise.
  if (!maxConfigured()) {
    return NextResponse.json({ ok: true, skipped: "MAX_BOT_TOKEN не задан" });
  }
  const secret = req.headers.get("x-max-bot-api-secret");
  if (secret !== process.env.MAX_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const update = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!update) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const transport = maxTransport();
  const type = String(update.update_type || "");

  // Same reasoning as Telegram's update_id table: a webhook that did not
  // answer fast enough is redelivered, and a repeat must not create a second
  // task. Any error other than a duplicate fails open.
  const key = dedupeKey(update);
  if (key) {
    const { error } = await admin.from("max_processed_updates").insert({ update_key: key });
    if (error && error.code === "23505") return NextResponse.json({ ok: true });
  }

  if (type === "message_callback") {
    const callback = update.callback as { callback_id?: string; payload?: string; user?: { user_id?: number } } | undefined;
    const message = update.message as { body?: { mid?: string } } | undefined;
    const chatId = callback?.user?.user_id;
    const action = decodeCallback(callback?.payload || "");
    if (!callback?.callback_id || !chatId || !action) return NextResponse.json({ ok: true });

    const outcome = await handleColleagueCallback(admin, chatId, action, MAX_CHANNEL);
    await transport.resolveCallback({
      callbackId: callback.callback_id,
      chatId,
      messageId: message?.body?.mid,
      toast: outcome.toast,
      rewriteTo: outcome.rewriteTo,
    });
    if (outcome.notifyOwner) {
      const owner = await admin.from("assignees").select("user_id").eq("max_user_id", chatId).limit(1).maybeSingle();
      if (owner.data?.user_id) await notifyOwner(admin, owner.data.user_id as string, outcome.notifyOwner);
    }
    return NextResponse.json({ ok: true });
  }

  if (type === "bot_started") {
    const user = update.user as { user_id?: number; username?: string } | undefined;
    const chatId = user?.user_id;
    if (!chatId) return NextResponse.json({ ok: true });
    const ctx: BotContext = { admin, transport, channel: MAX_CHANNEL, chatId };
    // The code travels in the link the person tapped; without one this is
    // just someone opening the bot, and handleLinkCode says how to connect.
    await handleLinkCode(ctx, String(update.payload || ""), user?.username || null);
    return NextResponse.json({ ok: true });
  }

  if (type !== "message_created") return NextResponse.json({ ok: true });

  const message = update.message as
    | { sender?: { user_id?: number; username?: string }; body?: { text?: string; attachments?: unknown } }
    | undefined;
  const chatId = message?.sender?.user_id;
  if (!chatId) return NextResponse.json({ ok: true });

  const ctx: BotContext = { admin, transport, channel: MAX_CHANNEL, chatId };
  let text = typeof message?.body?.text === "string" ? message.body.text : "";

  if (!text.trim()) {
    const bytes = await oggVoiceBytes(message?.body?.attachments);
    if (!bytes) {
      // Only when there was something that isn't text at all — a message
      // with nothing in it needs no answer.
      if (Array.isArray(message?.body?.attachments) && message.body.attachments.length) {
        await transport.send(chatId, "Пока понимаю только текст и голосовые в формате OGG. Напишите словами — сделаю.");
      }
      return NextResponse.json({ ok: true });
    }
    try {
      await transport.send(chatId, "🎙 Распознаю голосовое…");
      const { transcribeOggOpus } = await import("@/lib/speechToText");
      const transcript = await transcribeOggOpus(bytes);
      if (!transcript) {
        await transport.send(chatId, "Не расслышал — попробуйте ещё раз или напишите текстом.");
        return NextResponse.json({ ok: true });
      }
      await transport.send(chatId, "🎙 Распознал: «" + transcript + "»");
      text = transcript;
    } catch (e) {
      await transport.send(chatId, "Не получилось распознать голос: " + (e instanceof Error ? e.message : String(e)));
      return NextResponse.json({ ok: true });
    }
  }

  if (text.startsWith("/start")) {
    await handleLinkCode(ctx, text.replace("/start", ""), message?.sender?.username || null);
    return NextResponse.json({ ok: true });
  }

  await handleText(ctx, text);
  return NextResponse.json({ ok: true });
}
