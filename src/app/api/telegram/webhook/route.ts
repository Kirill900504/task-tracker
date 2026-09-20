import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadTelegramFile, telegramTransport } from "@/lib/telegram";
import { decodeCallback, findColleagueByChat } from "@/lib/colleagues";
import { handleColleagueFile } from "@/lib/colleagueReplies";
import { deliverCallbackNotice, handleBotCallback } from "@/lib/botCallback";
import { handleLinkCode, handleText, type BotContext } from "@/lib/botPipeline";
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
    // Один разбор на оба мессенджера, и он же решает, чья это кнопка —
    // коллеги или владельца (см. lib/botCallback).
    const outcome = await handleBotCallback(admin, pressedChatId, action, TELEGRAM_CHANNEL);
    await transport.resolveCallback({
      callbackId: callbackQuery.id,
      chatId: pressedChatId,
      messageId: callbackQuery.message?.message_id != null ? String(callbackQuery.message.message_id) : undefined,
      toast: outcome.toast,
      rewriteTo: outcome.rewriteTo,
      rewriteButtons: outcome.rewriteButtons,
    });
    // Отдельным сообщением: список, карточка или «пишите — отправлю в
    // обсуждение». Переписать нажатое сообщение здесь нельзя — под ним
    // остаются кнопки, которые ещё понадобятся.
    if (outcome.say) {
      await transport.send(pressedChatId, outcome.say, outcome.sayButtons?.length ? { buttons: outcome.sayButtons } : undefined);
    }
    await deliverCallbackNotice(admin, pressedChatId, TELEGRAM_CHANNEL, outcome);
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
    const { error: dedupError } = await admin
      .from("bot_processed_updates")
      .insert({ channel: "telegram", update_key: String(updateId) });
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

  // Фотография или документ от коллеги — в обсуждение задачи.
  //
  // Раньше это просто терялось: вебхук читал только текст и голос, и
  // человек, приславший фотографию сделанного, был уверен, что показал её.
  // Только от коллеги: у владельца фотография в этом чате ничего не значит,
  // а заводить ей задачу — угадывание, которого он не просил.
  const photo = Array.isArray(message?.photo) ? message.photo[message.photo.length - 1] : null;
  const document = message?.document;
  if (photo || document) {
    const colleague = await findColleagueByChat(admin, chatId, TELEGRAM_CHANNEL);
    if (!colleague) return NextResponse.json({ ok: true });
    try {
      const fileId: string = photo?.file_id || document?.file_id;
      const bytes = await downloadTelegramFile(fileId);
      const answered = await handleColleagueFile(
        admin,
        colleague,
        {
          bytes,
          // У фотографии имени нет вовсе — Telegram отдаёт её без него.
          name: document?.file_name || `photo-${Date.now()}.jpg`,
          type: document?.mime_type || "image/jpeg",
        },
        typeof message?.caption === "string" ? message.caption : "",
        "telegram",
      );
      await transport.send(
        chatId,
        answered?.reply || "Пока не к чему приложить: у вас нет открытых задач.",
      );
    } catch (e) {
      await transport.send(chatId, "Не получилось сохранить файл: " + (e instanceof Error ? e.message : String(e)));
    }
    return NextResponse.json({ ok: true });
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
