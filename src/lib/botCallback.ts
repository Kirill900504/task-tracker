import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotChannelConfig } from "@/lib/botTransport";
import type { CallbackAction } from "@/lib/colleagues";
import { meetingButtons, screenButtons, type ColleagueRow } from "@/lib/colleagues";
import { notifyAuthor } from "@/lib/botDelivery";
import { sendToPerson } from "@/lib/reach";
import { handleColleagueCallback } from "@/lib/colleagueReplies";
import { handleOwnerCallback } from "@/lib/ownerReplies";
import { findActorByChat, type BotActor } from "@/lib/botActor";
import { createTaskFromBot, resolveWhen } from "@/lib/ownerNewTask";
import { ownerNav } from "@/lib/ownerQueries";
import type { CallbackOutcome } from "@/lib/colleagueReplies";

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
  const actor = await findActorByChat(admin, chatId, channel);
  if (actor) {
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
      });
    }
    // Шаг мастера «Поручить»: кому выбрали — помним до выбора срока.
    if (outcome.setPending) {
      const previous = await pendingOf(admin, actor, channel, chatId);
      await remember(admin, actor, channel, chatId, {
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
  for (const person of ((people || []) as ColleagueRow[])) {
    await sendToPerson(admin, ownerId, person, text, meetingButtons(meetingId));
  }
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
  for (const person of ((people || []) as ColleagueRow[])) {
    await sendToPerson(admin, ownerId, person, text);
  }
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
  const { data } = await admin.from("assignees").select("user_id").eq(channel.chatColumn, chatId).limit(1).maybeSingle();
  const ownerId = (data as { user_id: string } | null)?.user_id;
  if (ownerId) await notifyAuthor(admin, ownerId, outcome.notifyTo ?? null, outcome.notifyOwner, outcome.notice);
}
