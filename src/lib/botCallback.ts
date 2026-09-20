import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotChannelConfig } from "@/lib/botTransport";
import type { CallbackAction } from "@/lib/colleagues";
import { chatsFor, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague, notifyAuthor } from "@/lib/botDelivery";
import { handleColleagueCallback } from "@/lib/colleagueReplies";
import { findOwnerByChat, handleOwnerCallback } from "@/lib/ownerReplies";
import type { CallbackOutcome } from "@/lib/colleagueReplies";

// Нажатая кнопка — один разбор на оба мессенджера.
//
// Тот же довод, что и у botPipeline: две копии «что значит это нажатие»
// разойдутся в течение месяца, и тогда один и тот же бот будет вести себя
// в Telegram иначе, чем в MAX. Маршруты остаются переводчиками своего
// формата обновлений.
//
// Порядок проверок важен. Сначала коллега — потому что его чат привязан к
// строке человека, и именно там живут «Принял / Сделал». Потом владелец:
// его чат в другой таблице, и кнопки у него другие — «Принять работу»,
// «Вернуть», «Продлить срок». Один и тот же чат не может быть и тем и
// другим: подключение разводит их с самого начала.

export async function handleBotCallback(
  admin: SupabaseClient,
  chatId: number,
  action: CallbackAction,
  channel: BotChannelConfig,
): Promise<CallbackOutcome> {
  const owner = await findOwnerByChat(admin, chatId, channel);
  if (owner) {
    const today = new Date().toISOString().slice(0, 10);
    const outcome = await handleOwnerCallback(admin, owner.userId, action, today);
    if (!outcome) {
      // Кнопка не владельческая — скорее всего пришла из сообщения, которое
      // ему переслали или которое он получил как участник. Молчать нельзя:
      // нажатие без ответа читается как сломанная кнопка.
      return { toast: "Эта кнопка не для вас" };
    }

    // Сказать исполнителям — сразу и без сводки: от них ждут ответа.
    if (outcome.tellAssignees) {
      await tellAssignees(admin, outcome.tellAssignees.taskId, outcome.tellAssignees.text);
    }
    // Возврат на доработку ждёт слов: следующее сообщение владельца станет
    // причиной. Помнится там же, где все незакрытые вопросы бота.
    if (outcome.askReturn) {
      await admin
        .from(channel.accountsTable)
        .update({ pending_action: { kind: "review_return", taskId: outcome.askReturn.taskId, title: outcome.askReturn.title } })
        .eq(channel.chatColumn, chatId);
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

async function tellAssignees(admin: SupabaseClient, taskId: string, text: string): Promise<void> {
  const { data: parts } = await admin
    .from("task_participants")
    .select("assignee_id")
    .eq("task_id", taskId)
    .in("role", ["executor", "coexecutor"]);
  const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id);
  if (!ids.length) return;
  const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", ids);
  for (const person of ((people || []) as ColleagueRow[])) {
    const target = chatsFor(person)[0];
    if (target) await sendToColleague(target, text);
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
