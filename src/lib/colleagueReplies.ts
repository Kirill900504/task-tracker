import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDate } from "@/lib/taskDisplay";
import type { CallbackAction } from "@/lib/colleagues";
import { findColleagueByChat } from "@/lib/colleagues";

// What happens when a colleague presses a button under a task or a meeting.
//
// The button carries only an id, and every check happens here against the
// database: the chat has to belong to a colleague, that colleague has to be
// the person the item is actually addressed to, and the item has to belong
// to their owner. Nothing is taken from the message itself — a callback can
// be replayed or forged, an id is not a permission.

export type CallbackOutcome = {
  // Shown as a small toast on the button the person tapped.
  toast: string;
  // The message is rewritten to this, so the chat shows what happened
  // instead of buttons that no longer do anything.
  rewriteTo?: string;
  // The owner hears about it in their own chat.
  notifyOwner?: { chatId: number; text: string };
};

export function colleagueHelp(name: string): string {
  return (
    `${name}, сюда приходят задачи и встречи — отвечать можно кнопками под сообщением.\n\n` +
    "Свои задачи здесь не заводятся: это канал в одну сторону, чтобы ничего не терялось."
  );
}

async function ownerChat(admin: SupabaseClient, userId: string): Promise<number | null> {
  const { data } = await admin.from("telegram_accounts").select("telegram_chat_id").eq("user_id", userId).limit(1).maybeSingle();
  return (data?.telegram_chat_id as number) ?? null;
}

export async function handleColleagueCallback(
  admin: SupabaseClient,
  chatId: number,
  action: CallbackAction,
): Promise<CallbackOutcome> {
  const colleague = await findColleagueByChat(admin, chatId);
  if (!colleague) return { toast: "Этот чат не подключён" };

  if (action.kind === "task") {
    const { data: task } = await admin
      .from("tasks")
      .select("id, title, assignee, user_id, status")
      .eq("id", action.id)
      .is("deleted_at", null)
      .maybeSingle();
    // Addressed to someone else, or belonging to another owner: the same
    // answer either way, so a stray id tells the presser nothing.
    if (!task || task.user_id !== colleague.user_id || task.assignee !== colleague.name) {
      return { toast: "Эта задача уже не ваша" };
    }

    if (action.action === "acc") {
      await admin.from("tasks").update({ accepted_at: new Date().toISOString() }).eq("id", task.id);
      const chat = await ownerChat(admin, colleague.user_id);
      return {
        toast: "Принято",
        rewriteTo: `📋 ${task.title}\n\n✅ Принято в работу`,
        notifyOwner: chat ? { chatId: chat, text: `✅ ${colleague.name} принял в работу: «${task.title}»` } : undefined,
      };
    }

    if (action.action === "done") {
      await admin
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", task.id);
      const chat = await ownerChat(admin, colleague.user_id);
      return {
        toast: "Отмечено выполненным",
        rewriteTo: `📋 ${task.title}\n\n🏁 Выполнено`,
        notifyOwner: chat ? { chatId: chat, text: `🏁 ${colleague.name} выполнил: «${task.title}»` } : undefined,
      };
    }
  }

  if (action.kind === "meeting" && action.action === "yes") {
    const { data: meeting } = await admin
      .from("meetings")
      .select("id, title, date, time, participants, confirmed_by, user_id")
      .eq("id", action.id)
      .is("deleted_at", null)
      .maybeSingle();
    const participants = (meeting?.participants as string[]) || [];
    if (!meeting || meeting.user_id !== colleague.user_id || !participants.includes(colleague.name)) {
      return { toast: "Эта встреча уже не ваша" };
    }

    const confirmed = (meeting.confirmed_by as string[]) || [];
    if (!confirmed.includes(colleague.name)) {
      await admin
        .from("meetings")
        .update({ confirmed_by: [...confirmed, colleague.name] })
        .eq("id", meeting.id);
    }
    const chat = await ownerChat(admin, colleague.user_id);
    const when = fmtDate(meeting.date as string) + (meeting.time ? ", " + meeting.time : "");
    return {
      toast: "Отметил, что будете",
      rewriteTo: `📅 ${meeting.title}\n${when}\n\n✅ Вы подтвердили участие`,
      notifyOwner: chat ? { chatId: chat, text: `✅ ${colleague.name} будет на встрече «${meeting.title}» (${when})` } : undefined,
    };
  }

  return { toast: "Это действие больше не доступно" };
}
