import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage, downloadTelegramFile } from "@/lib/telegram";
import { parseQuickAdd } from "@/lib/quickAdd";
import { checkRateLimit } from "@/lib/rateLimit";
import { matchQueryCommand, replyForQuery } from "@/lib/telegramQueries";
import { handleManageItem, resolvePendingAction, type ManageAction, type ManageItemType, type PendingAction } from "@/lib/telegramManage";

// Voice transcription (cold-start model download + WASM inference) can run
// well past the default function timeout — Vercel's default is too short.
export const maxDuration = 60;

function uid(): string {
  return "tg" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function droppedNote(dropped: string[]): string {
  if (!dropped.length) return "";
  return "\n⚠ Не нашёл в списке исполнителей, пропустил: " + dropped.join(", ");
}

async function replyForResult(
  chatId: number,
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  tool: string,
  input: Record<string, unknown>,
  droppedNames: string[],
) {
  if (tool === "create_task") {
    const row = {
      id: uid(),
      user_id: userId,
      title: String(input.title || ""),
      description: String(input.description || ""),
      assignee: String(input.assignee || ""),
      priority: input.priority === "high" ? "high" : "med",
      term: input.term === "long" ? "long" : "short",
      status: "in_progress",
      deadline: input.deadline || null,
      recur: "none",
    };
    const { error } = await admin.from("tasks").insert(row);
    if (error) {
      await sendTelegramMessage(chatId, "Не получилось сохранить задачу: " + error.message);
      return;
    }
    const lines = [`✓ Задача: «${row.title}»`];
    if (row.deadline) lines.push("Срок: " + fmtDate(row.deadline as string));
    if (row.assignee) lines.push("Исполнитель: " + row.assignee);
    if (row.priority === "high") lines.push("Приоритет: высокий");
    await sendTelegramMessage(chatId, lines.join("\n") + droppedNote(droppedNames));
    return;
  }

  if (tool === "create_meeting") {
    const row = {
      id: uid(),
      user_id: userId,
      date: String(input.date || ""),
      time: String(input.time || ""),
      title: String(input.title || ""),
      participants: Array.isArray(input.participants) ? input.participants : [],
      status: "planned",
      result: "",
    };
    if (!row.date) {
      await sendTelegramMessage(chatId, "Не понял дату встречи — уточните, пожалуйста.");
      return;
    }
    const { error } = await admin.from("meetings").insert(row);
    if (error) {
      await sendTelegramMessage(chatId, "Не получилось сохранить встречу: " + error.message);
      return;
    }
    const lines = [`✓ Встреча: «${row.title}»`, `${fmtDate(row.date)}${row.time ? ", " + row.time : ""}`];
    if (row.participants.length) lines.push("Участники: " + row.participants.join(", "));
    await sendTelegramMessage(chatId, lines.join("\n") + droppedNote(droppedNames));
    return;
  }

  if (tool === "create_idea") {
    const row = {
      id: uid(),
      user_id: userId,
      text: String(input.text || ""),
      important: !!input.important,
      done: false,
    };
    const { error } = await admin.from("ideas").insert(row);
    if (error) {
      await sendTelegramMessage(chatId, "Не получилось сохранить идею: " + error.message);
      return;
    }
    await sendTelegramMessage(chatId, `💡 Идея сохранена: «${row.text}»`);
    return;
  }

  if (tool === "ask_clarifying_question") {
    await sendTelegramMessage(chatId, String(input.question || "Уточните, пожалуйста."));
    return;
  }

  if (tool === "manage_item") {
    const action = input.action as ManageAction;
    const itemType = input.itemType as ManageItemType;
    const query = String(input.query || "").trim();
    if (!query) {
      await sendTelegramMessage(chatId, "Не понял, какую задачу или встречу вы имеете в виду — уточните название.");
      return;
    }
    const { reply, pendingAction } = await handleManageItem(userId, action, itemType, query);
    if (pendingAction) {
      await admin.from("telegram_accounts").update({ pending_action: pendingAction }).eq("telegram_chat_id", chatId);
    }
    await sendTelegramMessage(chatId, reply);
    return;
  }

  // cant_help, or anything unrecognized — an honest "I don't do that" beats
  // silently failing or (the bug this replaced) echoing the user's message.
  await sendTelegramMessage(
    chatId,
    "Пока умею только заводить задачи/встречи/идеи по фразе — на вопросы отвечать не умею. " +
      "Хотите создать задачу или встречу — напишите её как поручение, например «завтра позвонить Сергею».",
  );
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const update = await req.json().catch(() => null);
  const message = update?.message;
  const chatId: number | undefined = message?.chat?.id;
  const voiceFileId: string | undefined = message?.voice?.file_id;
  let text: string | undefined = message?.text;

  if (!chatId) {
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
      const { transcribeOggOpus } = await import("@/lib/speechToText");
      const bytes = await downloadTelegramFile(voiceFileId);
      const transcript = await transcribeOggOpus(bytes);
      if (!transcript) {
        await sendTelegramMessage(chatId, "Не расслышал — попробуйте ещё раз или напишите текстом.");
        return NextResponse.json({ ok: true });
      }
      await sendTelegramMessage(chatId, "🎙 Распознал: «" + transcript + "»");
      text = transcript;
    } catch (e) {
      await sendTelegramMessage(chatId, "Не получилось распознать голос: " + (e instanceof Error ? e.message : String(e)));
      return NextResponse.json({ ok: true });
    }
  }

  // Always 200 — Telegram retries aggressively on non-2xx, and there's
  // nothing useful to retry here (bad/irrelevant updates, missing text).
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();

  if (text.startsWith("/start")) {
    const code = text.replace("/start", "").trim();
    if (!code) {
      await sendTelegramMessage(chatId, "Откройте трекер на сайте и нажмите «Подключить Telegram», чтобы получить код.");
      return NextResponse.json({ ok: true });
    }
    const { data: linkRow, error: lookupError } = await admin
      .from("telegram_link_codes")
      .select("user_id, expires_at")
      .eq("code", code)
      .maybeSingle();

    if (lookupError) {
      await sendTelegramMessage(chatId, "Внутренняя ошибка базы: " + lookupError.message);
      return NextResponse.json({ ok: true });
    }
    if (!linkRow || new Date(linkRow.expires_at).getTime() < Date.now()) {
      await sendTelegramMessage(chatId, "Код неверный или уже истёк. Запросите новый в приложении.");
      return NextResponse.json({ ok: true });
    }

    const { error: upsertError } = await admin
      .from("telegram_accounts")
      .upsert({ telegram_chat_id: chatId, user_id: linkRow.user_id });
    if (upsertError) {
      await sendTelegramMessage(chatId, "Не удалось привязать аккаунт: " + upsertError.message);
      return NextResponse.json({ ok: true });
    }
    await admin.from("telegram_link_codes").delete().eq("code", code);
    await sendTelegramMessage(
      chatId,
      "✓ Готово, аккаунт привязан. Теперь просто пишите сюда — например «завтра позвонить Сергею».\n" +
        "Также понимаю: «сегодня», «просрочено», «встречи», «помощь».",
    );
    return NextResponse.json({ ok: true });
  }

  const { data: account, error: accountError } = await admin
    .from("telegram_accounts")
    .select("user_id, pending_context, pending_action")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  if (accountError) {
    await sendTelegramMessage(chatId, "Внутренняя ошибка базы: " + accountError.message);
    return NextResponse.json({ ok: true });
  }
  if (!account) {
    await sendTelegramMessage(chatId, "Этот чат ещё не привязан. Откройте трекер на сайте → «Подключить Telegram».");
    return NextResponse.json({ ok: true });
  }

  const { allowed } = await checkRateLimit(admin, account.user_id, "telegram", 20, 60);
  if (!allowed) {
    await sendTelegramMessage(chatId, "Слишком много сообщений подряд, подождите минуту.");
    return NextResponse.json({ ok: true });
  }

  // A pending delete confirmation always wins over everything else — the
  // next message is either "да" or a cancel, never a new request.
  if (account.pending_action) {
    await admin.from("telegram_accounts").update({ pending_action: null }).eq("telegram_chat_id", chatId);
    const reply = await resolvePendingAction(account.pending_action as PendingAction, text);
    await sendTelegramMessage(chatId, reply);
    return NextResponse.json({ ok: true });
  }

  // Read-only query commands ("сегодня", "просрочено", "встречи") are matched
  // before quick-add — free, instant, and can't be misparsed by the LLM.
  // They also break out of any pending clarify flow, since answering "сегодня"
  // to a clarifying question isn't a real answer to it.
  const queryKind = matchQueryCommand(text);
  if (queryKind) {
    if (account.pending_context) {
      await admin.from("telegram_accounts").update({ pending_context: null }).eq("telegram_chat_id", chatId);
    }
    const reply = await replyForQuery(queryKind, account.user_id);
    await sendTelegramMessage(chatId, reply);
    return NextResponse.json({ ok: true });
  }

  const hadPendingContext = !!account.pending_context;
  const effectiveText = hadPendingContext ? `${account.pending_context}. Уточнение: ${text.trim()}` : text.trim();
  if (hadPendingContext) {
    await admin.from("telegram_accounts").update({ pending_context: null }).eq("telegram_chat_id", chatId);
  }

  const { data: assigneeRows } = await admin.from("assignees").select("name").eq("user_id", account.user_id);
  const assignees = (assigneeRows || []).map((r) => r.name as string);

  try {
    let { tool, input, droppedNames } = await parseQuickAdd(effectiveText, assignees);

    // Loop guard: allow at most ONE clarifying round-trip. An exact-text
    // comparison here previously let this slip through in production — the
    // model phrased each follow-up slightly differently, so it never matched,
    // and pending_context grew without bound across many replies (turning
    // into an ever-larger, eventually corrupted blob that kept re-triggering
    // the same stuck question). Capping by round instead of by text content
    // closes that regardless of what the model says the second time.
    if (tool === "ask_clarifying_question" && hadPendingContext) {
      tool = "cant_help";
      input = {};
      droppedNames = [];
    }

    if (tool === "ask_clarifying_question") {
      // Defensive cap — this can only ever be the *first* round now, but
      // truncate anyway so a single oversized message can't wedge the column.
      await admin
        .from("telegram_accounts")
        .update({ pending_context: effectiveText.slice(0, 500) })
        .eq("telegram_chat_id", chatId);
    }
    await replyForResult(chatId, admin, account.user_id, tool, input, droppedNames);
  } catch (e) {
    await sendTelegramMessage(chatId, "Не получилось разобрать сообщение: " + (e instanceof Error ? e.message : String(e)));
  }

  return NextResponse.json({ ok: true });
}
