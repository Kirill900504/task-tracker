import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadTelegramFile, telegramTransport } from "@/lib/telegram";
import { decodeCallback } from "@/lib/colleagues";
import { handleColleagueCallback } from "@/lib/colleagueReplies";
import { handleLinkCode, handleText, type BotContext } from "@/lib/botPipeline";
import { notifyOwner } from "@/lib/botDelivery";
import { TELEGRAM_CHANNEL } from "@/lib/botTransport";

// Telegram's side of the bot: the update format, voice files, and Telegram's
// own retry behaviour. What a message MEANS is not decided here — that is
// botPipeline.ts, shared with MAX, so the two bots can never drift apart.

// Voice transcription (cold-start model download + WASM inference) can run
// well past the default function timeout — Vercel's default is too short.
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const update = await req.json().catch(() => null);
  const updateId: number | undefined = update?.update_id;
  const callbackQuery = update?.callback_query;
  const message = update?.message;
  const chatId: number | undefined = message?.chat?.id;
  const voiceFileId: string | undefined = message?.voice?.file_id;
  let text: string | undefined = message?.text;

  const admin = createAdminClient();
  const transport = telegramTransport();

  // A tapped button under a task or a meeting. Handled before anything
  // else: it carries its own chat and needs none of the machinery below.
  if (callbackQuery) {
    const pressedChatId: number | undefined = callbackQuery.message?.chat?.id;
    const action = decodeCallback(callbackQuery.data);
    if (!pressedChatId || !action) {
      await transport.resolveCallback({ callbackId: callbackQuery.id, chatId: pressedChatId ?? 0, toast: "Не понял, что нажато" });
      return NextResponse.json({ ok: true });
    }
    const outcome = await handleColleagueCallback(admin, pressedChatId, action, TELEGRAM_CHANNEL);
    await transport.resolveCallback({
      callbackId: callbackQuery.id,
      chatId: pressedChatId,
      messageId: callbackQuery.message?.message_id != null ? String(callbackQuery.message.message_id) : undefined,
      toast: outcome.toast,
      rewriteTo: outcome.rewriteTo,
    });
    if (outcome.notifyOwner) {
      const colleagueOwner = await admin.from("assignees").select("user_id").eq("telegram_chat_id", pressedChatId).limit(1).maybeSingle();
      if (colleagueOwner.data?.user_id) await notifyOwner(admin, colleagueOwner.data.user_id as string, outcome.notifyOwner);
    }
    return NextResponse.json({ ok: true });
  }

  if (!chatId) {
    return NextResponse.json({ ok: true });
  }

  const ctx: BotContext = { admin, transport, channel: TELEGRAM_CHANNEL, chatId };

  // Telegram redelivers an update it didn't get a fast/successful response
  // to — observed in production as the bot repeating the same reply to the
  // same voice message minutes apart while a bug made that message fail.
  // Insert-or-skip on update_id stops reprocessing a redelivered update
  // outright, regardless of what's causing the retry.
  if (updateId != null) {
    const { error: dedupError } = await admin.from("telegram_processed_updates").insert({ update_id: updateId });
    // 23505 = unique_violation — already handled this exact update, skip
    // silently instead of sending another reply for the same message. Any
    // *other* error (e.g. the migration for this table not applied yet)
    // fails open and processes normally — same principle as
    // checkRateLimit(): a missing migration should never be the reason a
    // legitimate message goes unanswered.
    if (dedupError && dedupError.code === "23505") {
      return NextResponse.json({ ok: true });
    }
  }

  // Voice message: transcribe it, then treat the result exactly like a
  // typed message — same rate limit, same quick-add/query/manage pipeline.
  if (!text && voiceFileId) {
    try {
      // Dynamic import on purpose — this pulls in transformers.js/ONNX,
      // which must never be loaded for a plain text message. A previous
      // version imported it statically at module scope and an unrelated
      // native-binding load failure there 500'd the *entire* webhook,
      // including plain task-creation texts (and Telegram retries a 500,
      // which risked creating duplicate tasks from the retried message).
      // A cold container downloads the ~40MB model before it can transcribe
      // anything, which takes the best part of a minute — say so, otherwise
      // the bot just looks dead for that whole time.
      await transport.send(chatId, "🎙 Распознаю голосовое…");
      const { transcribeOggOpus } = await import("@/lib/speechToText");
      const bytes = await downloadTelegramFile(voiceFileId);
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

  // Always 200 — Telegram retries aggressively on non-2xx, and there's
  // nothing useful to retry here (bad/irrelevant updates, missing text).
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ ok: true });
  }

  if (text.startsWith("/start")) {
    await handleLinkCode(ctx, text.replace("/start", ""), message?.from?.username || null);
    return NextResponse.json({ ok: true });
  }

  await handleText(ctx, text);
  return NextResponse.json({ ok: true });
}
