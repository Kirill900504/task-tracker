import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotChannelConfig, BotTransport } from "@/lib/botTransport";
import { colleagueHelp, handleColleagueText } from "@/lib/colleagueReplies";
import { navButtons } from "@/lib/colleagueQueries";
import { findColleagueByChat } from "@/lib/colleagues";
import { notifyAuthor } from "@/lib/botDelivery";
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
import { attachExecutors, attachMeetingParticipants, assignNote } from "@/lib/assignExecutors";
import { searchTracker, summariseSearch } from "@/lib/trackerSearch";
import { newTaskRow } from "@/lib/newTask";
import { ownerListReply, ownerMeetingsReply, ownerMenu } from "@/lib/ownerQueries";
import { whenButtons, whoButtons, type NewTaskPending } from "@/lib/ownerNewTask";
import { closeMeeting } from "@/lib/meetingRecap";
import { applyReview } from "@/lib/reviewWork";
import { deliverComment } from "@/lib/commentDelivery";
import { actorName } from "@/lib/actorName";

// Незакрытый вопрос «что доделать»: его ставит кнопка «Вернуть» в
// мессенджере, а закрывает следующее сообщение владельца.
type ReturnPending = { kind: "review_return"; taskId: string; title: string };
type RecapPending = { kind: "meeting_recap"; meetingId: string; title: string };
// Куда адресован следующий текст постановщика: кнопка «💬 Ответить» под
// карточкой. Без неё его свободный текст — поручение, а не реплика, и
// написать в обсуждение из мессенджера было бы нечем.
type OwnerReplyPending = { kind: "owner_reply"; replyKind: "task" | "meeting"; itemId: string; title: string; at: string };

// Столько живёт направленный ответ — как и у получателя задачи
// (colleagueReplies): нажал, отвлёкся, написал о другом — и это другое
// должно уйти туда, куда ушло бы без нажатия.
const AIM_LIFETIME_MS = 2 * 60 * 60 * 1000;

function isOwnerReply(p: unknown): p is OwnerReplyPending {
  return !!p && (p as OwnerReplyPending).kind === "owner_reply";
}
type MeetingRecapRow = {
  id: string;
  title: string;
  date: string;
  time: string | null;
  user_id: string;
  from_task_id: string | null;
  result: string | null;
};

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

// Реплика постановщика в обсуждение — после нажатой кнопки «💬 Ответить».
//
// Вставку делает служебный ключ, поэтому автор проставляется руками:
// `author_user_id` — это и есть «писал сам постановщик», по нему рассылка
// отличает его слова от чужих и не шлёт ему же копию. Пространство
// подставит триггер (миграция 0019), а разослать надо через ту же
// commentDelivery, что и трекер: правило «кому дошло» одно на все двери.
async function writeOwnerComment(
  ctx: BotContext,
  userId: string,
  aim: OwnerReplyPending,
  body: string,
): Promise<string> {
  const { data: inserted, error } = await ctx.admin
    .from("item_comments")
    .insert({
      item_kind: aim.replyKind,
      item_id: aim.itemId,
      body,
      author_user_id: userId,
      source: ctx.channel.id === "max" ? "max" : "telegram",
    })
    .select("id")
    .maybeSingle();
  // Молчать нельзя: человек считает, что написал, а его слов нигде нет.
  if (error || !inserted) return "Не получилось записать сообщение — попробуйте ещё раз.";

  await deliverComment(ctx.admin, (inserted as { id: string }).id);
  return `💬 Записал в обсуждение ${aim.replyKind === "task" ? "задачи" : "встречи"} «${aim.title}» — участники получат.`;
}

// Remembers something for the NEXT message from this chat — a clarifying
// question waiting for an answer, or an action waiting for «да».
async function remember(ctx: BotContext, patch: Record<string, unknown>) {
  await ctx.admin.from(ctx.channel.accountsTable).update(patch).eq(ctx.channel.chatColumn, ctx.chatId);
}

// Задача на нескольких человек — одна задача.
//
// До этого бот знал только поле assignee: фраза «поручи Игорю и Никите»
// превращалась в две одинаковые задачи, по одной на каждого, и связь между
// ними терялась вместе со смыслом («сделайте вдвоём»). Теперь имена
// приходят списком (см. executors в quickAdd), и каждому заводится своя
// строка участия — та же, что появляется при постановке задачи из трекера.
//
// Здесь же человек и узнаёт о задаче. «Назначена» — уведомление, которое
// нельзя выключить: поставить задачу и не сказать — это ровно тот случай,
// ради которого всё это затевалось. Ночью трекер молчит, задача придёт
// утренней сводкой.
//
// Само назначение переехало в assignExecutors.ts: тем же заняты задачи,
// надиктованные списком после встречи, и раньше эти два места делали разное
// (одно тихо теряло строку, второе не заводило её вовсе).

async function respondToTool(ctx: BotContext, userId: string, tool: string, input: Record<string, unknown>, droppedNames: string[]) {
  if (tool === "create_task") {
    const row = newTaskRow({
      id: uid(),
      userId,
      title: String(input.title || ""),
      description: String(input.description || ""),
      assignee: String(input.assignee || ""),
      deadline: (input.deadline as string) || null,
    });
    const { error } = await ctx.admin.from("tasks").insert(row);
    if (error) {
      await say(ctx, "Не получилось сохранить задачу: " + error.message);
      return;
    }

    const extra = Array.isArray(input.executors) ? (input.executors as unknown[]).filter((n): n is string => typeof n === "string") : [];
    const assigned = await attachExecutors(ctx.admin, userId, row, [row.assignee, ...extra]);

    const lines = [`✓ Задача: «${row.title}»`];
    if (row.deadline) lines.push("Срок: " + fmtDate(row.deadline as string));
    // Множественное число не украшение: «Исполнитель: Игорь» под задачей,
    // которая стоит на двоих, — это и есть «я думал, что поручил обоим».
    //
    // И только те, кто действительно назначен. Раньше здесь стояло имя из
    // поля даже тогда, когда строка участия не завелась: ответ подтверждал
    // назначение, которого не было, а выяснялось это неделей позже.
    const shown = assigned.attached;
    if (shown.length === 1) lines.push("Исполнитель: " + shown[0]);
    if (shown.length > 1) lines.push("Исполнители: " + shown.join(", "));
    await say(ctx, lines.join("\n") + droppedNote(droppedNames) + assignNote(assigned));
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
    // Строки голосования — не то же самое, что список имён на карточке:
    // без них у людей нет кнопок «Буду / Не смогу», нет напоминаний и нет
    // строки «не ответили». Раньше их заводило только окно карточки, и
    // встреча, созданная голосом, оказывалась приглашением без адресатов.
    const invited = await attachMeetingParticipants(
      ctx.admin,
      userId,
      row.id,
      (row.participants as unknown[]).filter((n): n is string => typeof n === "string"),
    );
    const lines = [`✓ Встреча: «${row.title}»`, `${fmtDate(row.date)}${row.time ? ", " + row.time : ""}`];
    if (invited.attached.length) lines.push("Участники: " + invited.attached.join(", "));
    await say(ctx, lines.join("\n") + droppedNote(droppedNames) + assignNote(invited));
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

// Память бота для человека без аккаунта: разобранная фраза, ждущая «да»
// (миграция 0033). У владельца то же самое лежит в его строке аккаунта.
async function pendingFor(admin: SupabaseClient, assigneeId: string): Promise<PendingAction | null> {
  const { data } = await admin.from("assignees").select("pending_action").eq("id", assigneeId).maybeSingle();
  return ((data as { pending_action?: PendingAction } | null)?.pending_action as PendingAction) || null;
}

async function clearPending(admin: SupabaseClient, assigneeId: string): Promise<void> {
  await admin.from("assignees").update({ pending_action: null }).eq("id", assigneeId);
}

// Логин этого человека, если он вошёл в трекер. Пусто — он только получатель
// сообщений, и поручать от его имени нечего.
async function managerIdOf(admin: SupabaseClient, assigneeId: string): Promise<string | null> {
  const { data } = await admin
    .from("workspace_members")
    .select("member_id, status")
    .eq("assignee_id", assigneeId)
    .eq("status", "active")
    .maybeSingle();
  return (data as { member_id: string | null } | null)?.member_id || null;
}

// Фраза руководителя, похожая на поручение: разобрать, показать и ждать «да».
//
// Ничего не создаётся молча. Это то же правило, по которому подтверждаются
// задачи из надиктованного совещания: модель может ошибиться и в имени, и в
// сроке, а поручение, появившееся у человека без ведома поручившего, —
// худший вид ошибки в этом трекере.
//
// Возвращает false, если фраза поручением не была: тогда выше покажется
// справка, как и раньше.
async function offerTask(
  ctx: BotContext,
  colleague: { id: string; name: string; user_id: string },
  memberId: string,
  text: string,
): Promise<boolean> {
  const { data: assigneeRows } = await ctx.admin.from("assignees").select("name").eq("user_id", colleague.user_id);
  const known = (assigneeRows || []).map((r) => r.name as string);

  let items;
  try {
    ({ items } = await parseQuickAdd(text, known));
  } catch {
    // Модель не ответила — это не повод отвечать человеку ошибкой про JSON.
    return false;
  }

  const tasks = items
    .filter((it) => it.tool === "create_task")
    .map((it) => ({
      title: String(it.input.title || "").trim(),
      assignee: String(it.input.assignee || "").trim(),
      deadline: (it.input.deadline as string) || "",
    }))
    .filter((t) => t.title);
  if (!tasks.length) return false;

  await ctx.admin
    .from("assignees")
    .update({ pending_action: { kind: "create_tasks", userId: colleague.user_id, createdBy: memberId, tasks } })
    .eq("id", colleague.id);

  const lines = tasks.map((t, i) => {
    const bits = [t.assignee || "без исполнителя"];
    if (t.deadline) bits.push("до " + fmtDate(t.deadline));
    return `${i + 1}) ${t.title} — ${bits.join(", ")}`;
  });
  await say(
    ctx,
    `Поручить?\n${lines.join("\n")}\n\nОтветьте «да» — любой другой ответ отменит.`,
  );
  return true;
}

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
      // Отложенное подтверждение всегда старше всего остального: следующее
      // сообщение — это «да» или отказ, а не новая просьба.
      const waiting = await pendingFor(ctx.admin, colleague.id);
      if (waiting) {
        await clearPending(ctx.admin, colleague.id);
        await say(ctx, await resolvePendingAction(waiting, trimmed));
        return;
      }

      // Раньше здесь был тупик: «это канал в одну сторону». Он и был им,
      // пока единственным ответом коллеги было нажатие кнопки. Теперь
      // кнопка «Сделал» просит сказать, что именно сделано, а «Не могу» —
      // почему, и вот этот текст и приходит сюда следующим сообщением.
      // Кто перед нами: руководитель со входом в трекер или человек,
      // которому просто пишут. От этого зависит, чем считать его фразу.
      const asManager = await managerIdOf(ctx.admin, colleague.id);
      const answered = await handleColleagueText(ctx.admin, colleague, trimmed, ctx.channel.id, !!asManager);
      if (answered) {
        await ctx.transport.send(ctx.chatId, answered.reply, answered.buttons?.length ? { buttons: answered.buttons } : undefined);
        if (answered.notifyOwner) await notifyAuthor(ctx.admin, colleague.user_id, answered.notifyTo ?? null, answered.notifyOwner, answered.notice);
        return;
      }

      // Руководитель может поручить отсюда же.
      //
      // Быстрый ввод был только у владельца, и, чтобы поставить одну задачу,
      // руководителю приходилось открывать трекер — для человека, который
      // весь день за рулём, это ровно та преграда, из-за которой поручение
      // не становится задачей. Право у него есть (миграция 0031), не хватало
      // двери.
      //
      // Только тому, у кого есть членство: коллега без входа в трекер — это
      // человек, которому пишут, и заводить от его имени задачи в чужом
      // пространстве было бы подлогом.
      if (asManager) {
        const offered = await offerTask(ctx, colleague, asManager, trimmed);
        if (offered) return;
      }

      // Ответить оказалось нечем — ни задачи, ни встречи, ни команды.
      // Справка идёт с кнопками списков: человеку, который ещё не знает, что
      // тут можно, показать это дешевле, чем рассказать.
      await ctx.transport.send(ctx.chatId, colleagueHelp(colleague.name), { buttons: navButtons() });
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
    // Возврат на доработку: нажали кнопку, теперь пишут, что именно
    // доделать. Правила возврата — общие с трекером (lib/reviewWork):
    // отчёты обнуляются, людям говорится сразу, в хронику пишется строка.
    // Один столбец памяти на все незакрытые вопросы бота: подтверждение
    // «да», причина возврата, шаг мастера. Разбирается он по полю kind, и
    // потому читается сначала как неизвестное.
    const waiting = account.pending_action as PendingAction | ReturnPending | NewTaskPending;
    if ((waiting as unknown as ReturnPending).kind === "review_return") {
      const ask = waiting as unknown as ReturnPending;
      const { data: taskRow } = await ctx.admin
        .from("tasks")
        .select("id, title, user_id")
        .eq("id", ask.taskId)
        .eq("user_id", account.user_id)
        .is("deleted_at", null)
        .maybeSingle();
      const task = taskRow as { id: string; title: string; user_id: string } | null;
      if (!task) {
        await say(ctx, "Эта задача больше не найдена.");
        return;
      }
      const done = await applyReview(ctx.admin, task, "return", trimmed, { label: await actorName(ctx.admin, task.user_id, account.user_id), userId: account.user_id });
      await say(ctx, done.ok ? `↩ Вернул «${task.title}» на доработку — исполнителям сказано.` : done.error);
      return;
    }
    // Итог встречи, пришедший словами после кнопки «Записать итог».
    // Правила — общие с трекером (lib/meetingRecap): разослать тем, кто
    // был, записать в хронику и вернуть в задачу, если встреча выросла
    // из неё.
    if ((waiting as unknown as RecapPending).kind === "meeting_recap") {
      const ask = waiting as unknown as RecapPending;
      const { data: row } = await ctx.admin
        .from("meetings")
        .select("id, title, date, time, user_id, from_task_id, result")
        .eq("id", ask.meetingId)
        .eq("user_id", account.user_id)
        .is("deleted_at", null)
        .maybeSingle();
      const meeting = row as MeetingRecapRow | null;
      if (!meeting) {
        await say(ctx, "Эта встреча больше не найдена.");
        return;
      }
      await closeMeeting(ctx.admin, meeting, "success", trimmed);
      await say(ctx, "📝 Итог записан и разослан тем, кто был.");
      return;
    }

    // Реплика в обсуждение — после кнопки «💬 Ответить».
    //
    // Для владельца это единственный способ написать в задачу из
    // мессенджера: его свободный текст здесь — поручение, а не реплика.
    // Живёт намерение два часа и ровно одно сообщение, как и у коллеги
    // (takeAim в colleagueReplies): нажал, отвлёкся, написал о другом —
    // и это другое должно уйти туда, куда ушло бы без нажатия.
    // Остывшее намерение не съедает сообщение: оно обрабатывается как
    // обычный текст владельца, то есть как поручение, — ровно так же, как
    // если бы кнопку не нажимали вовсе.
    if (isOwnerReply(waiting)) {
      const fresh = Date.now() - (Date.parse(waiting.at || "") || 0) < AIM_LIFETIME_MS;
      if (fresh) {
        await say(ctx, await writeOwnerComment(ctx, account.user_id, waiting, trimmed));
        return;
      }
    }

    // Первый шаг мастера «Поручить»: пришло название. Спрашиваем, кому, —
    // кнопками, потому что имя, набранное руками, промахивается мимо
    // списка людей, а имя, названное моделью, промахивается ещё чаще.
    if ((waiting as unknown as NewTaskPending).kind === "new_task" && (waiting as unknown as NewTaskPending).stage === "title") {
      const title = trimmed.slice(0, 200);
      if (!title) {
        await say(ctx, "Пустое название — не задача. Напишите, что поручить.");
        return;
      }
      // Человек мог быть выбран заранее — «Поручить ему» из его карточки.
      // Тогда шаг «кому» уже пройден, и спрашивать его второй раз значит
      // переспрашивать то, что человек только что нажал.
      const chosen = (waiting as unknown as { people?: { name: string; role: "executor" | "coexecutor" | "watcher" }[] }).people;
      if (chosen?.length) {
        await remember(ctx, { pending_action: { kind: "new_task", stage: "when", title, people: chosen } });
        await ctx.transport.send(ctx.chatId, `«${title}» — ${chosen.map((p) => p.name).join(", ")}. На когда?`, {
          buttons: whenButtons(),
        });
        return;
      }
      await remember(ctx, { pending_action: { kind: "new_task", stage: "who", title } });
      await ctx.transport.send(ctx.chatId, `«${title}»\n\nКому поручить?`, {
        buttons: await whoButtons(ctx.admin, account.user_id),
      });
      return;
    }

    // Второй и третий шаги отвечают кнопкой, а не словом. Если человек всё
    // же написал — не теряем ни шаг, ни написанное: память возвращается на
    // место, а кнопки показываются снова.
    if ((waiting as unknown as NewTaskPending).kind === "new_task") {
      await remember(ctx, { pending_action: waiting });
      await ctx.transport.send(ctx.chatId, "Выберите кнопкой — или начните заново словом «меню».", {
        buttons: await whoButtons(ctx.admin, account.user_id),
      });
      return;
    }

    // Остывшее «💬 Ответить» сюда не адресовано: resolvePendingAction
    // разбирает подтверждения («да»), и незнакомая ему память ответила бы
    // «Отменено, „undefined“ не тронул».
    if (!isOwnerReply(waiting)) {
      await say(ctx, await resolvePendingAction(waiting as PendingAction, trimmed));
      return;
    }
  }

  // «Меню» — то же, что кнопка «☰ Меню», только словом. Человек, открывший
  // чат спустя неделю, кнопок не видит: они уехали вверх вместе с
  // сообщениями.
  if (/^(меню|menu|\/menu|что умеешь|start|\/start)$/i.test(trimmed)) {
    const menu = ownerMenu();
    await ctx.transport.send(ctx.chatId, menu.text, menu.buttons?.length ? { buttons: menu.buttons } : undefined);
    return;
  }

  // Read-only query commands ("сегодня", "просрочено", "встречи") are matched
  // before quick-add — free, instant, and can't be misparsed by the LLM.
  // They also break out of any pending clarify flow, since answering "сегодня"
  // to a clarifying question isn't a real answer to it.
  const queryKind = matchQueryCommand(trimmed);
  if (queryKind) {
    if (account.pending_context) await remember(ctx, { pending_context: null });
    // Кнопками, а не голым текстом: список, из которого нельзя открыть
    // задачу, — это список, после которого всё равно открывать трекер.
    const which = queryKind === "today" ? "today" : queryKind === "overdue" ? "overdue" : "";
    if (queryKind === "meetings") {
      const reply = await ownerMeetingsReply(ctx.admin, account.user_id, new Date().toISOString().slice(0, 10));
      await ctx.transport.send(ctx.chatId, reply.text, reply.buttons?.length ? { buttons: reply.buttons } : undefined);
      return;
    }
    if (which) {
      const reply = await ownerListReply(ctx.admin, account.user_id, which, new Date().toISOString().slice(0, 10));
      await ctx.transport.send(ctx.chatId, reply.text, reply.buttons?.length ? { buttons: reply.buttons } : undefined);
      return;
    }
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
