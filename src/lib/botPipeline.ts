import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotChannelConfig, BotTransport } from "@/lib/botTransport";
import { colleagueHelp, handleColleagueText } from "@/lib/colleagueReplies";
import { findColleagueByChat } from "@/lib/colleagues";
import { notifyOwner } from "@/lib/botDelivery";
import { parseQuickAdd } from "@/lib/quickAdd";
import { checkRateLimit } from "@/lib/rateLimit";
import { matchQueryCommand, replyForQuery } from "@/lib/telegramQueries";
import { handleManageItem, resolvePendingAction, type ManageAction, type ManageItemType, type PendingAction } from "@/lib/telegramManage";
import { logAiAction } from "@/lib/aiActionLog";
import { buildTrackerContext } from "@/lib/trackerContext";
import { answerTrackerQuestion } from "@/lib/telegramAssistant";
import { extractMeetingNotes } from "@/lib/meetingNotes";
import { findMeetingForNotes } from "@/lib/meetingLink";
import { planBulkMove, describePlan, type BulkScope } from "@/lib/bulkActions";
import { searchTracker, summariseSearch } from "@/lib/trackerSearch";

// What the bot DOES with a message — the whole of it, and none of the
// business of getting that message off the wire.
//
// This was the body of the Telegram webhook until MAX arrived. Splitting it
// out is not tidiness: a second messenger with its own copy of "what «да»
// means", "when a task is created without asking", "how a meeting recap is
// confirmed" would drift from the first within a month, and the two would
// then be different assistants wearing the same name. The routes now only
// translate their own update format and hand the text to this.

export type BotContext = {
  admin: SupabaseClient;
  transport: BotTransport;
  channel: BotChannelConfig;
  chatId: number;
};

function uid(): string {
  return "bot" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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

function say(ctx: BotContext, text: string) {
  return ctx.transport.send(ctx.chatId, text);
}

// Remembers something for the NEXT message from this chat — a clarifying
// question waiting for an answer, or an action waiting for «да».
async function remember(ctx: BotContext, patch: Record<string, unknown>) {
  await ctx.admin.from(ctx.channel.accountsTable).update(patch).eq(ctx.channel.chatColumn, ctx.chatId);
}

async function respondToTool(ctx: BotContext, userId: string, tool: string, input: Record<string, unknown>, droppedNames: string[]) {
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
    const { error } = await ctx.admin.from("tasks").insert(row);
    if (error) {
      await say(ctx, "Не получилось сохранить задачу: " + error.message);
      return;
    }
    const lines = [`✓ Задача: «${row.title}»`];
    if (row.deadline) lines.push("Срок: " + fmtDate(row.deadline as string));
    if (row.assignee) lines.push("Исполнитель: " + row.assignee);
    if (row.priority === "high") lines.push("Приоритет: высокий");
    await say(ctx, lines.join("\n") + droppedNote(droppedNames));
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
      await say(ctx, "Не понял дату встречи — уточните, пожалуйста.");
      return;
    }
    const { error } = await ctx.admin.from("meetings").insert(row);
    if (error) {
      await say(ctx, "Не получилось сохранить встречу: " + error.message);
      return;
    }
    const lines = [`✓ Встреча: «${row.title}»`, `${fmtDate(row.date)}${row.time ? ", " + row.time : ""}`];
    if (row.participants.length) lines.push("Участники: " + row.participants.join(", "));
    await say(ctx, lines.join("\n") + droppedNote(droppedNames));
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
    const { error } = await ctx.admin.from("ideas").insert(row);
    if (error) {
      await say(ctx, "Не получилось сохранить идею: " + error.message);
      return;
    }
    await say(ctx, `💡 Идея сохранена: «${row.text}»`);
    return;
  }

  if (tool === "ask_clarifying_question") {
    await say(ctx, String(input.question || "Уточните, пожалуйста."));
    return;
  }

  if (tool === "manage_item") {
    const action = input.action as ManageAction;
    const itemType = input.itemType as ManageItemType;
    const query = String(input.query || "").trim();
    if (!query) {
      await say(ctx, "Не понял, какую задачу или встречу вы имеете в виду — уточните название.");
      return;
    }
    const { reply, pendingAction } = await handleManageItem(userId, action, itemType, query);
    if (pendingAction) await remember(ctx, { pending_action: pendingAction });
    await say(ctx, reply);
    return;
  }

  if (tool === "meeting_notes") {
    const notes = String(input.text || "").trim();
    if (!notes) {
      await say(ctx, "Не расслышал итоги встречи — перескажите ещё раз.");
      return;
    }
    const { data: assigneeRows } = await ctx.admin.from("assignees").select("name").eq("user_id", userId);
    const known = (assigneeRows || []).map((r) => r.name as string);
    const { summary, tasks } = await extractMeetingNotes(notes, known);
    // Which meeting this recap is about, if any still stands open — matched
    // in code, see meetingLink. When it matches, the same confirmation also
    // closes that meeting and writes the recap into its card, so a dictated
    // outcome doesn't leave the meeting hanging as "запланирована".
    const meeting = await findMeetingForNotes(ctx.admin, userId, notes);
    const meetingLine = meeting ? `🗓 Встречу «${meeting.title}» от ${fmtDate(meeting.date)} закрою и запишу в неё этот итог.` : "";
    const pendingMeeting = meeting && summary ? { id: meeting.id, title: meeting.title, result: meeting.result, summary } : undefined;

    if (!tasks.length) {
      if (pendingMeeting) {
        await remember(ctx, { pending_action: { kind: "create_tasks", userId, tasks: [], meeting: pendingMeeting } });
        await say(
          ctx,
          "📝 " + summary + "\n\nПоручений в рассказе не нашёл.\n" + meetingLine + "\n\nЗакрываю? Ответьте «да» — любой другой ответ отменит.",
        );
        return;
      }
      await say(
        ctx,
        (summary ? "📝 " + summary + "\n\n" : "") + "Поручений в этом рассказе не нашёл. Если что-то нужно завести — скажите отдельной фразой.",
      );
      return;
    }

    // Never created straight away: a monologue is exactly the input where a
    // model can turn a passing remark into a task, so the list is shown and
    // waits for an explicit "да" (handled by resolvePendingAction).
    const lines = tasks.map((t, i) => {
      const bits = [t.assignee || "без исполнителя"];
      if (t.deadline) bits.push("до " + fmtDate(t.deadline));
      if (t.priority === "high") bits.push("важно");
      return `${i + 1}) ${t.title} — ${bits.join(", ")}`;
    });
    await remember(ctx, { pending_action: { kind: "create_tasks", userId, tasks, meeting: pendingMeeting } });
    await say(
      ctx,
      (summary ? "📝 " + summary + "\n\n" : "") +
        `Нашёл поручений: ${tasks.length}\n${lines.join("\n")}\n` +
        (pendingMeeting ? meetingLine + "\n" : "") +
        "\nСоздать их? Ответьте «да» — любой другой ответ отменит.\n" +
        "Проверьте список: если что-то пропущено, допишите отдельным сообщением.",
    );
    return;
  }

  if (tool === "bulk_move") {
    const scope = (["tasks", "meetings", "both"] as const).includes(input.scope as BulkScope) ? (input.scope as BulkScope) : "both";
    const { plan, error } = await planBulkMove(userId, { scope, from: String(input.from || ""), to: String(input.to || "") });
    if (error || !plan) {
      await say(ctx, error || "Не понял, что переносить.");
      return;
    }
    // Shown and confirmed before anything moves — a bulk edit is the one
    // place a misunderstanding is expensive to undo.
    await remember(ctx, { pending_action: { kind: "bulk_move", plan } });
    await say(ctx, describePlan(plan) + "\n\nПереношу? Ответьте «да» — любой другой ответ отменит.");
    return;
  }

  if (tool === "search_tracker") {
    const query = String(input.query || "").trim();
    if (!query) {
      await say(ctx, "Что искать? Назовите тему или человека.");
      return;
    }
    const hits = await searchTracker(ctx.admin, userId, query);
    await say(ctx, await summariseSearch(query, hits));
    return;
  }

  if (tool === "answer_question") {
    const question = String(input.query || "").trim();
    if (!question) {
      await say(ctx, "Не понял вопрос — переспросите, пожалуйста.");
      return;
    }
    // Two-step on purpose: the parse above only decided "this is a question".
    // The answer needs the user's actual data, which is fetched here and
    // handed to the model as a read-only snapshot (see trackerContext).
    const context = await buildTrackerContext(ctx.admin, userId);
    await say(ctx, await answerTrackerQuestion(question, context));
    return;
  }

  // cant_help, or anything unrecognized — an honest "I don't do that" beats
  // silently failing or (the bug this replaced) echoing the user's message.
  await say(
    ctx,
    "Это не похоже ни на поручение, ни на вопрос о делах. " +
      "Напишите поручение («завтра позвонить Сергею») или спросите про свои задачи («что горит на этой неделе»).",
  );
}

// The connection handshake, identical in both messengers: a short-lived code
// is issued in the app, the person opens the bot with it, and the code says
// whether this chat becomes the owner's own or one colleague's.
export async function handleLinkCode(ctx: BotContext, rawCode: string, username: string | null): Promise<boolean> {
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    await say(ctx, `Откройте трекер на сайте и нажмите «Подключить ${ctx.channel.label}», чтобы получить код.`);
    return true;
  }

  const { data: linkRow, error: lookupError } = await ctx.admin
    .from("telegram_link_codes")
    .select("user_id, expires_at, assignee_id, channel")
    .eq("code", code)
    .maybeSingle();

  if (lookupError) {
    await say(ctx, "Внутренняя ошибка базы: " + lookupError.message);
    return true;
  }
  // A code issued for the other messenger is not valid here — it was shown
  // with a different bot's link, and honouring it would attach the wrong chat.
  if (!linkRow || linkRow.channel !== ctx.channel.id || new Date(linkRow.expires_at).getTime() < Date.now()) {
    await say(ctx, "Код неверный или уже истёк. Запросите новый в приложении.");
    return true;
  }

  // A code issued for a colleague attaches this chat to that person instead
  // of granting access to the tracker. They get what is sent to them and
  // nothing else — see colleagueReplies.ts.
  if (linkRow.assignee_id) {
    const { data: person, error: linkError } = await ctx.admin
      .from("assignees")
      .update({
        [ctx.channel.chatColumn]: ctx.chatId,
        [ctx.channel.usernameColumn]: username || null,
        [ctx.channel.linkedAtColumn]: new Date().toISOString(),
      })
      .eq("id", linkRow.assignee_id)
      .select("name")
      .maybeSingle();
    if (linkError) {
      await say(ctx, "Не удалось подключиться: " + linkError.message);
      return true;
    }
    await ctx.admin.from("telegram_link_codes").delete().eq("code", code);
    await say(ctx, `✓ Готово, ${person?.name || "вы"} на связи. Сюда будут приходить задачи и встречи — отвечать можно кнопками под сообщением.`);
    return true;
  }

  const { error: upsertError } = await ctx.admin
    .from(ctx.channel.accountsTable)
    .upsert({ [ctx.channel.chatColumn]: ctx.chatId, user_id: linkRow.user_id });
  if (upsertError) {
    await say(ctx, "Не удалось привязать аккаунт: " + upsertError.message);
    return true;
  }
  await ctx.admin.from("telegram_link_codes").delete().eq("code", code);
  await say(
    ctx,
    "✓ Готово, аккаунт привязан. Теперь просто пишите сюда — например «завтра позвонить Сергею».\n" +
      "Также понимаю: «сегодня», «просрочено», «встречи», «помощь».",
  );
  return true;
}

// A code typed or pasted on its own, rather than arriving through the link.
// MAX has no /start command to carry it, and in Telegram people paste it too.
const CODE_SHAPE = /^[A-HJ-NP-Z2-9]{8}$/;

export async function handleText(ctx: BotContext, text: string): Promise<void> {
  const trimmed = text.trim();

  const { data: account, error: accountError } = await ctx.admin
    .from(ctx.channel.accountsTable)
    .select("user_id, pending_context, pending_action")
    .eq(ctx.channel.chatColumn, ctx.chatId)
    .maybeSingle();

  if (accountError) {
    await say(ctx, "Внутренняя ошибка базы: " + accountError.message);
    return;
  }

  if (!account) {
    // Not connected: either this is the code that connects it, or there is
    // nothing this chat can be told.
    if (CODE_SHAPE.test(trimmed.toUpperCase())) {
      await handleLinkCode(ctx, trimmed, null);
      return;
    }
    const colleague = await findColleagueByChat(ctx.admin, ctx.chatId, ctx.channel);
    if (colleague) {
      // Раньше здесь был тупик: «это канал в одну сторону». Он и был им,
      // пока единственным ответом коллеги было нажатие кнопки. Теперь
      // кнопка «Сделал» просит сказать, что именно сделано, а «Не могу» —
      // почему, и вот этот текст и приходит сюда следующим сообщением.
      const answered = await handleColleagueText(ctx.admin, colleague, trimmed);
      if (answered) {
        await say(ctx, answered.reply);
        if (answered.notifyOwner) await notifyOwner(ctx.admin, colleague.user_id, answered.notifyOwner);
        return;
      }
      await say(ctx, colleagueHelp(colleague.name));
      return;
    }
    await say(ctx, `Этот чат ещё не привязан. Откройте трекер на сайте → «Подключить ${ctx.channel.label}».`);
    return;
  }

  const { allowed } = await checkRateLimit(ctx.admin, account.user_id, ctx.channel.id, 20, 60);
  if (!allowed) {
    await say(ctx, "Слишком много сообщений подряд, подождите минуту.");
    return;
  }

  // A pending confirmation always wins over everything else — the next
  // message is either "да" or a cancel, never a new request.
  if (account.pending_action) {
    await remember(ctx, { pending_action: null });
    await say(ctx, await resolvePendingAction(account.pending_action as PendingAction, trimmed));
    return;
  }

  // Read-only query commands ("сегодня", "просрочено", "встречи") are matched
  // before quick-add — free, instant, and can't be misparsed by the LLM.
  // They also break out of any pending clarify flow, since answering "сегодня"
  // to a clarifying question isn't a real answer to it.
  const queryKind = matchQueryCommand(trimmed);
  if (queryKind) {
    if (account.pending_context) await remember(ctx, { pending_context: null });
    await say(ctx, await replyForQuery(queryKind, account.user_id));
    return;
  }

  const hadPendingContext = !!account.pending_context;
  const effectiveText = hadPendingContext ? `${account.pending_context}. Уточнение: ${trimmed}` : trimmed;
  if (hadPendingContext) await remember(ctx, { pending_context: null });

  const { data: assigneeRows } = await ctx.admin.from("assignees").select("name").eq("user_id", account.user_id);
  const assignees = (assigneeRows || []).map((r) => r.name as string);

  try {
    const { items } = await parseQuickAdd(effectiveText, assignees);
    let toProcess = items;

    // Loop guard: allow at most ONE clarifying round-trip. An exact-text
    // comparison here previously let this slip through in production — the
    // model phrased each follow-up slightly differently, so it never matched,
    // and pending_context grew without bound across many replies (turning
    // into an ever-larger, eventually corrupted blob that kept re-triggering
    // the same stuck question). Capping by round instead of by text content
    // closes that regardless of what the model says the second time. Only
    // applies when the whole message is a single clarifying question — a
    // multi-item batch that includes one alongside real items just drops it
    // below instead.
    if (toProcess.length === 1 && toProcess[0].tool === "ask_clarifying_question" && hadPendingContext) {
      toProcess = [{ tool: "cant_help", input: {}, droppedNames: [] }];
    }

    const isSingleClarify = toProcess.length === 1 && toProcess[0].tool === "ask_clarifying_question";
    if (isSingleClarify) {
      // Defensive cap — this can only ever be the *first* round now, but
      // truncate anyway so a single oversized message can't wedge the column.
      await remember(ctx, { pending_context: effectiveText.slice(0, 500) });
    }

    // A clarifying question can't be answered in a multi-item batch (there's
    // nowhere to hold several pending questions at once) — process the
    // actionable items and quietly drop that one rather than derail the
    // whole message over an unclear fragment.
    const finalItems = isSingleClarify ? toProcess : toProcess.filter((it) => it.tool !== "ask_clarifying_question");
    for (const it of finalItems) {
      await respondToTool(ctx, account.user_id, it.tool, it.input, it.droppedNames);
    }
    await logAiAction(ctx.admin, {
      userId: account.user_id,
      source: ctx.channel.id,
      inputText: effectiveText,
      success: true,
      resultSummary: finalItems.map((it) => it.tool).join(", "),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Classification failed — most often because the message was a question
    // and the model answered it in prose instead of returning JSON. Rather
    // than show "В ответе нет JSON", treat it as a question: that path only
    // reads data, so the worst case is an unhelpful answer, never a wrong
    // edit. A real failure there falls through to the error message.
    try {
      const context = await buildTrackerContext(ctx.admin, account.user_id);
      await say(ctx, await answerTrackerQuestion(effectiveText, context));
      await logAiAction(ctx.admin, { userId: account.user_id, source: ctx.channel.id, inputText: effectiveText, success: true, resultSummary: "answer_question (fallback)" });
    } catch {
      await say(ctx, "Не получилось разобрать сообщение: " + message);
      await logAiAction(ctx.admin, { userId: account.user_id, source: ctx.channel.id, inputText: effectiveText, success: false, errorMessage: message });
    }
  }
}
