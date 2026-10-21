import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotChannelConfig } from "@/lib/botTransport";
import type { CallbackAction } from "@/lib/colleagues";
import { findColleagueByChat, findOwnerSelfByChat, meetingButtons, screenButtons, type ColleagueRow } from "@/lib/colleagues";
import { notifyAuthor } from "@/lib/botDelivery";
import { sendToPerson } from "@/lib/reach";
import { handleColleagueCallback } from "@/lib/colleagueReplies";
import { handleOwnerCallback } from "@/lib/ownerReplies";
import { findActorByChat, type BotActor } from "@/lib/botActor";
import { createTaskFromBot, nextNewTaskStep, resolveWhen } from "@/lib/ownerNewTask";
import { ownerNav } from "@/lib/ownerQueries";
import type { CallbackOutcome } from "@/lib/colleagueReplies";
import { handleIdeaInbox, isIdeaInboxAction } from "@/lib/ideaInbox";
import { cancelMeetingFromBot, handleProposeCallback, isProposeAction, splitTarget, type CancelConfirmPending, type MovePending } from "@/lib/botMoveFlow";
import { lessonActor, saveLesson } from "@/lib/botMemory";
// Только типы: сам модуль умений тянет разбор фразы (и GigaChat за ним), а
// нажатию кнопки он нужен в трёх ветках — там он и подгружается.
import type { ConfirmPending, SlotPending } from "@/lib/botSkills";

// Нажатая кнопка — один разбор на оба мессенджера.
//
// Тот же довод, что и у botPipeline: две копии «что значит это нажатие»
// разойдутся в течение месяца, и тогда один и тот же бот будет вести себя
// в Telegram иначе, чем в MAX. Маршруты остаются переводчиками своего
// формата обновлений.
//
// Кто нажал — вопрос не «владелец или коллега», а «что он вправе».
//
// До 20.09.2026 половина постановщика (принять работу, вернуть, продлить,
// напомнить, поручить, списки, меню) была привязана к чату владельца:
// нажатие искало строку в таблице аккаунтов, а у руководителя её нет.
// То есть человек, поставивший задачу, не мог принять по ней работу из
// мессенджера вовсе — за этим он шёл в трекер. Слова Кирилла: «надо чтоб
// каждый человек мог принять работу из мессенджера и делать любые
// манипуляции, так как сейчас мы делаем абсолютно равноправный для всех
// постановщик задач».
//
// Поэтому чат превращается в АКТОРА (lib/botActor): кто нажал, в чьём
// пространстве и видит ли он в нём всё. Сначала пробуется половина
// постановщика — она сама откажет в чужой задаче, потому что чужая в его
// выборку не попадает, — потом половина получателя: «Принял / Сделал /
// Не могу» живут на строке человека и работают у всех, включая владельца
// (ему тоже ставят задачи).

// Экран вместо ленты.
//
// Один и тот же ответ бота — список, карточка, меню — до 22.09.2026
// приходил НОВЫМ сообщением: три нажатия подряд оставляли в чате три
// сообщения, из которых живо только последнее. Слова Кирилла: «чтобы при
// нажатии кнопок не выдавало новым сообщением следующие стадии, а выдавало
// следующие уровни выборов… чтоб не засорять историю чата бота».
//
// Правило здесь одно и живёт в одном месте: если нажали ВНУТРИ экрана
// (кнопка помечена — см. screenButtons), то следующий уровень занимает
// место прежнего, а не встаёт под ним. Нажали под присланной задачей или
// под утренней сводкой — уровень открывается новым сообщением, потому что
// переписывать чужой текст нельзя: за ним человек сюда и пришёл.
//
// Второе следствие, без которого первое не работает: кнопки нового уровня
// сами становятся кнопками экрана. Забыть это — значит получить экран,
// который переписывается один раз, а дальше снова разрастается лентой.
export function asScreen(action: CallbackAction, outcome: CallbackOutcome): CallbackOutcome {
  const next: CallbackOutcome = { ...outcome };
  const wasScreen = action.fromScreen === true;
  if (wasScreen && next.say && !next.rewriteTo) {
    next.rewriteTo = next.say;
    next.rewriteButtons = next.sayButtons;
    next.say = undefined;
    next.sayButtons = undefined;
  }
  if (next.sayButtons?.length) next.sayButtons = screenButtons(next.sayButtons);
  // Кнопки переписанного сообщения помечаются только тогда, когда это
  // сообщение — экран. У присланной задачи «Принял» тоже переписывает
  // сообщение, но оно остаётся задачей, а не уровнем меню.
  if (next.rewriteButtons?.length && wasScreen) next.rewriteButtons = screenButtons(next.rewriteButtons);
  return next;
}

export async function handleBotCallback(
  admin: SupabaseClient,
  chatId: number,
  action: CallbackAction,
  channel: BotChannelConfig,
): Promise<CallbackOutcome> {
  return asScreen(action, await routeBotCallback(admin, chatId, action, channel));
}

async function routeBotCallback(
  admin: SupabaseClient,
  chatId: number,
  action: CallbackAction,
  channel: BotChannelConfig,
): Promise<CallbackOutcome> {
  // Кнопки под присланной мыслью адресованы ПОЛУЧАТЕЛЮ, кем бы он ни был в
  // остальном: владельцем, руководителем или человеком без входа. До
  // развилки ниже, иначе владельцу «Взять в работу» отвечала бы его
  // постановщицкая половина, где таких кнопок нет (lib/ideaInbox).
  if (isIdeaInboxAction(action)) return handleIdeaInbox(admin, chatId, action, channel);

  // «🕐 Другое время» под приглашением — тоже кнопка ПОЛУЧАТЕЛЯ, кем бы он
  // ни был: владелец, позванный руководителем, предлагает время своей
  // строкой «(я)», как и отвечает «Буду» (lib/botMoveFlow).
  if (isProposeAction(action)) {
    const person = (await findColleagueByChat(admin, chatId, channel)) || (await findOwnerSelfByChat(admin, chatId, channel));
    if (!person) return { toast: "Этот чат не подключён" };
    return handleProposeCallback(admin, person, action, channel.id);
  }

  const actor = await findActorByChat(admin, chatId, channel);
  if (actor) {
    // «Без описания» в мастере «Поручить»: следующий шаг зависит от того,
    // что лежит в памяти мастера (выбран ли уже человек), а память читает
    // только этот файл — поэтому кнопка разбирается здесь, до общего
    // разбора постановщицких кнопок.
    if (action.kind === "task" && action.action === "ndesc") {
      const pending = (await pendingOf(admin, actor, channel, chatId)) as Record<string, unknown> | null;
      if (!pending || pending.kind !== "new_task" || !pending.title) return { toast: "Начните заново: «Поручить»" };
      const step = await nextNewTaskStep(admin, actor.spaceId, { ...pending, description: "" });
      await remember(admin, actor, channel, chatId, step.pending);
      return { toast: "Без описания", rewriteTo: step.text, rewriteButtons: step.buttons };
    }
    // Кнопки умений словами (lib/botSkills). Что именно подтверждают, лежит
    // в памяти чата: в 64 байта кнопки приёмка с комментарием или список
    // людей не помещаются.
    if (action.kind === "task" && (action.action === "cfgo" || action.action === "cfno")) {
      const waiting = (await pendingOf(admin, actor, channel, chatId)) as ConfirmPending | null;
      if (waiting?.kind !== "bot_confirm") return { toast: "Уже неактуально", rewriteTo: "Это предложение устарело — скажите ещё раз.", rewriteButtons: ownerNav() };
      await remember(admin, actor, channel, chatId, null);
      if (action.action === "cfno") return { toast: "Ничего не меняю", rewriteTo: "Хорошо, ничего не меняю.", rewriteButtons: ownerNav() };
      const { runConfirmed } = await import("@/lib/botSkills");
      const text = await runConfirmed(admin, actor, waiting.op);
      if (/^[✓✅↩🔔]/u.test(text) && waiting.phrase && waiting.parsed) {
        await saveLesson(admin, { spaceId: actor.spaceId, actor: lessonActor(actor), phrase: waiting.phrase, parsed: waiting.parsed });
      }
      return { toast: "Готово", rewriteTo: text, rewriteButtons: ownerNav() };
    }
    if (action.kind === "meeting" && (action.action === "fsl" || action.action === "fsd")) {
      const waiting = (await pendingOf(admin, actor, channel, chatId)) as SlotPending | null;
      const { handleSlotCallback } = await import("@/lib/botSkills");
      const r = await handleSlotCallback(admin, actor, action, waiting);
      if (r.pending) await remember(admin, actor, channel, chatId, r.pending);
      return { toast: r.toast, rewriteTo: r.text, rewriteButtons: r.buttons?.length ? screenButtons(r.buttons) : undefined };
    }
    if (action.kind === "task" && action.action === "rmx") {
      const mine = actor.isOwner ? actor.spaceId : actor.userId;
      await admin.from("bot_reminders").update({ cancelled_at: new Date().toISOString() }).eq("id", action.id).eq("actor", mine).is("sent_at", null);
      return { toast: "Не напомню", rewriteTo: "✖ Напоминание снято." };
    }

    // «🚫 Отменить встречу» под отменой, сказанной словами: причина в 64
    // байта кнопки не помещается и лежит в памяти чата (lib/botMoveFlow).
    if (action.kind === "meeting" && action.action === "mvxgo") {
      const waiting = (await pendingOf(admin, actor, channel, chatId)) as CancelConfirmPending | null;
      if (waiting?.kind !== "meeting_cancel_confirm" || waiting.id !== action.id) {
        return { toast: "Отмена устарела — откройте встречу и нажмите «🚫 Отменить»" };
      }
      await remember(admin, actor, channel, chatId, null);
      const text = await cancelMeetingFromBot(admin, actor, { kind: "meeting_cancel", id: waiting.id, title: waiting.title, at: waiting.at }, waiting.reason);
      if (text.startsWith("🚫") && waiting.phrase && waiting.parsed) {
        await saveLesson(admin, { spaceId: actor.spaceId, actor: lessonActor(actor), phrase: waiting.phrase, parsed: waiting.parsed });
      }
      return { toast: "Готово", rewriteTo: text, rewriteButtons: ownerNav() };
    }

    const today = new Date().toISOString().slice(0, 10);
    const outcome = await handleOwnerCallback(admin, actor, action, today);
    if (!outcome) {
      // Кнопка не постановщицкая — но это ещё не значит «чужая». Тот же
      // человек бывает исполнителем: задача, поставленная ему, приходит в
      // этот же чат с кнопками «Принял» и «Сделал». Поэтому нажатие
      // пробуется как исполнительское и только потом объявляется чужим:
      // иначе половина кнопок в чате молча не работала бы.
      const asColleague = await handleColleagueCallback(admin, chatId, action, channel);
      if (asColleague.toast !== "Этот чат не подключён") return asColleague;
      // Молчать нельзя: нажатие без ответа читается как сломанная кнопка.
      return { toast: "Эта кнопка не для вас" };
    }

    if (outcome.clearPending) await remember(admin, actor, channel, chatId, null);
    // Перенос, предложенный по фразе, подтверждён кнопкой: фраза и её
    // разбор становятся уроком (lib/botMemory), а «да» больше ждать не надо.
    if (action.action === "mvgo" && outcome.toast === "Перенесено") {
      const waiting = (await pendingOf(admin, actor, channel, chatId)) as MovePending | null;
      if (waiting?.kind === "move_item" && waiting.id === splitTarget(action.id).id) {
        if (waiting.phrase && waiting.parsed) await saveLesson(admin, { spaceId: actor.spaceId, actor: lessonActor(actor), phrase: waiting.phrase, parsed: waiting.parsed });
        await remember(admin, actor, channel, chatId, null);
      }
    }

    // Сказать исполнителям — сразу и без сводки: от них ждут ответа.
    if (outcome.tellAssignees) {
      await tellAssignees(admin, outcome.tellAssignees.taskId, outcome.tellAssignees.text);
    }
    // То же для встречи: назначенное время надо занять в чужом дне, и
    // узнать об этом человек должен не из календаря на следующий день.
    if (outcome.tellMeeting) {
      await tellMeeting(admin, outcome.tellMeeting.meetingId, outcome.tellMeeting.text);
    }
    // Возврат на доработку ждёт слов: следующее сообщение владельца станет
    // причиной. Помнится там же, где все незакрытые вопросы бота.
    if (outcome.askReturn) {
      await remember(admin, actor, channel, chatId, {
        kind: "review_return",
        taskId: outcome.askReturn.taskId,
        title: outcome.askReturn.title,
        ...(outcome.askReturn.participantIds?.length ? { participantIds: outcome.askReturn.participantIds } : {}),
      });
    }
    // Шаг мастера «Поручить»: кому выбрали — помним до выбора срока.
    if (outcome.setPending) {
      const previous = await pendingOf(admin, actor, channel, chatId);
      // Детали задачи (шаг после названия) едут дальше вместе с мастером:
      // кнопка «кому» и «по разделу» о них не знает.
      const prevDescription = (previous as { kind?: string; description?: string } | null)?.kind === "new_task" ? (previous as { description?: string }).description : undefined;
      await remember(admin, actor, channel, chatId, {
        ...(prevDescription ? { description: prevDescription } : {}),
        ...outcome.setPending,
        // Название спросили на первом шаге; на втором его несёт память, а
        // не кнопка — в 64 байта callback_data оно не поместилось бы.
        title: (outcome.setPending as { title?: string }).title ?? (previous as { title?: string } | null)?.title,
      });
    }

    // Последний шаг: срок выбран, задачу можно заводить.
    if (outcome.finishNewTask !== undefined) {
      const pending = (await pendingOf(admin, actor, channel, chatId)) as
        | {
            kind?: string;
            title?: string;
            people?: { name: string; role: "executor" | "coexecutor" | "watcher" }[];
            fromIdea?: string;
            description?: string;
          }
        | null;
      if (!pending || pending.kind !== "new_task" || !pending.title || !pending.people?.length) {
        return { toast: "Начните заново: «Поручить»" };
      }
      await remember(admin, actor, channel, chatId, null);
      // Задача ложится в пространство, но автором остаётся тот, кто её
      // поручил: по `created_by` ему потом и придёт отчёт, и только он
      // сможет её принять (см. notifyAuthor и loadTask).
      const created = await createTaskFromBot(
        admin,
        actor.spaceId,
        pending.title,
        pending.people,
        resolveWhen(outcome.finishNewTask),
        actor.isOwner ? null : actor.userId,
        pending.description || "",
      );
      // Мысль, ставшая задачей, уходит из ящика — но только теперь, когда
      // задача действительно заведена. Мастер, брошенный на полпути, не
      // должен стирать запись.
      if (pending.fromIdea) {
        await admin
          .from("ideas")
          .update({ done: true, done_at: new Date().toISOString() })
          .eq("id", pending.fromIdea)
          .eq("user_id", actor.spaceId);
      }
      return { toast: "Поручено", rewriteTo: created.text, rewriteButtons: ownerNav() };
    }

    return {
      toast: outcome.toast,
      rewriteTo: outcome.rewriteTo,
      rewriteButtons: outcome.rewriteButtons,
      say: outcome.say,
      sayButtons: outcome.sayButtons,
    };
  }

  return handleColleagueCallback(admin, chatId, action, channel);
}

// Незакрытый вопрос бота — причина возврата, шаг мастера — живёт там же,
// где чат: у владельца в таблице аккаунтов, у остальных на строке
// человека (миграция 0033 завела её именно для этого). Одна колонка
// `pending_action` в обоих случаях, и разбирается она одинаково — иначе
// «Вернуть с причиной» работало бы у одного и молчало у тринадцати.
async function remember(
  admin: SupabaseClient,
  actor: BotActor,
  channel: BotChannelConfig,
  chatId: number,
  value: Record<string, unknown> | null,
): Promise<void> {
  if (actor.isOwner) {
    await admin.from(channel.accountsTable).update({ pending_action: value }).eq(channel.chatColumn, chatId);
    return;
  }
  await admin.from("assignees").update({ pending_action: value }).eq("id", actor.assigneeId);
}

async function pendingOf(
  admin: SupabaseClient,
  actor: BotActor,
  channel: BotChannelConfig,
  chatId: number,
): Promise<unknown> {
  if (actor.isOwner) {
    const { data } = await admin
      .from(channel.accountsTable)
      .select("pending_action")
      .eq(channel.chatColumn, chatId)
      .maybeSingle();
    return (data as { pending_action?: unknown } | null)?.pending_action ?? null;
  }
  const { data } = await admin.from("assignees").select("pending_action").eq("id", actor.assigneeId).maybeSingle();
  return (data as { pending_action?: unknown } | null)?.pending_action ?? null;
}

// Тем, кого позвали на встречу. Кнопки остаются ответами: назначенное
// время можно и не суметь — «Не смогу» после «Назначить» такой же
// законный ответ, как и до него.
// Пространство берётся из самой строки участия (его ставит триггер
// миграции 0019), а не передаётся сверху: оно нужно затем, чтобы дойти до
// владельца, если получатель — он. Его чат живёт в учётной записи, а не в
// строке списка людей (см. lib/reach).
async function tellMeeting(admin: SupabaseClient, meetingId: string, text: string): Promise<void> {
  const { data: parts } = await admin.from("meeting_participants").select("assignee_id, user_id").eq("meeting_id", meetingId);
  const rows = (parts || []) as { assignee_id: string; user_id: string }[];
  if (!rows.length) return;
  const ownerId = rows[0].user_id;
  const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", rows.map((r) => r.assignee_id));
  // Всем сразу, а не по очереди (см. reviewWork — та же причина).
  await Promise.all(((people || []) as ColleagueRow[]).map((person) => sendToPerson(admin, ownerId, person, text, meetingButtons(meetingId), { kind: "meeting", itemId: meetingId })));
}

async function tellAssignees(admin: SupabaseClient, taskId: string, text: string): Promise<void> {
  const { data: parts } = await admin
    .from("task_participants")
    .select("assignee_id, user_id")
    .eq("task_id", taskId)
    .in("role", ["executor", "coexecutor"]);
  const rows = (parts || []) as { assignee_id: string; user_id: string }[];
  if (!rows.length) return;
  const ownerId = rows[0].user_id;
  const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", rows.map((r) => r.assignee_id));
  await Promise.all(((people || []) as ColleagueRow[]).map((person) => sendToPerson(admin, ownerId, person, text)));
}

// Ответ коллеги, который надо донести до постановщика. Вынесено сюда
// вместе с разбором нажатия: маршруты делали это дважды, слово в слово.
export async function deliverCallbackNotice(
  admin: SupabaseClient,
  chatId: number,
  channel: BotChannelConfig,
  outcome: CallbackOutcome,
): Promise<void> {
  if (!outcome.notifyOwner) return;
  const { data } = await admin.from("assignees").select("id, user_id").eq(channel.chatColumn, chatId).limit(1).maybeSingle();
  const row = data as { id: string; user_id: string } | null;
  const ownerId = row?.user_id;
  if (!ownerId || !row) return;
  // Нажал сам постановщик — своя задача, своя кнопка. Сообщать ему о его
  // же нажатии незачем (то же правило, что в /api/workspace/report).
  if (outcome.notifyTo) {
    const { data: me } = await admin
      .from("workspace_members")
      .select("member_id")
      .eq("owner_id", ownerId)
      .eq("assignee_id", row.id)
      .maybeSingle();
    if ((me as { member_id?: string } | null)?.member_id === outcome.notifyTo) return;
  }
  await notifyAuthor(admin, ownerId, outcome.notifyTo ?? null, outcome.notifyOwner, outcome.notice);
}
