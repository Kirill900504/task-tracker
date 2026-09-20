import type { SupabaseClient } from "@supabase/supabase-js";
import { replyButtons, type ColleagueRow } from "@/lib/colleagues";
import { sendToPerson } from "@/lib/reach";
import { recordEvent } from "@/lib/itemHistory";
import { mergeResult } from "@/lib/meetingLink";
import { fmtDate } from "@/lib/taskDisplay";

// Итог встречи — одно правило на трекер и на бота.
//
// Правил тут три, и все три легко потерять, написав это во второй раз:
// итог уходит ТЕМ, КТО БЫЛ (ради этого половина из них и приходила);
// строка пишется в хронику встречи; и, если встреча выросла из задачи,
// итог дописывается в обсуждение этой задачи — иначе человек, открывший
// задачу через неделю, видит только, что когда-то по ней собирались.
//
// Поэтому ядро здесь, а маршрут /api/workspace/recap и кнопки в
// мессенджере только зовут его.

export type MeetingRef = {
  id: string;
  title: string;
  date: string;
  time: string | null;
  user_id: string;
  from_task_id: string | null;
  result?: string | null;
};

// Разослать итог и записать его следы. Сам статус встречи меняет тот, кто
// зовёт: в трекере это движок синхронизации (колонка его), в боте —
// closeMeeting ниже.
export async function deliverRecap(admin: SupabaseClient, meeting: MeetingRef, result: string): Promise<number> {
  const when = fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "");
  const text = `📝 Итог встречи «${meeting.title}» (${when}):\n\n${result}`;

  const { data: parts } = await admin.from("meeting_participants").select("assignee_id").eq("meeting_id", meeting.id);
  const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id);

  let sent = 0;
  if (ids.length) {
    const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", ids);
    for (const person of ((people || []) as ColleagueRow[])) {
      // Кнопка «Ответить» здесь не формальность: с итогом чаще всего и
      // спорят, и уточнять его будут именно в этот момент.
      if (await sendToPerson(admin, meeting.user_id, person, text, replyButtons("meeting", meeting.id))) sent++;
    }
  }

  await recordEvent(admin, { userId: meeting.user_id, kind: "meeting", itemId: meeting.id, text: `📝 Итог разослан участникам (${sent})` });

  // Встреча, выросшая из задачи, возвращает в неё ответ (миграция 0037).
  if (meeting.from_task_id) {
    await recordEvent(admin, {
      userId: meeting.user_id,
      kind: "task",
      itemId: meeting.from_task_id,
      text: `📝 Итог встречи «${meeting.title}» (${when}): ${result}`,
    });
  }

  return sent;
}

// Закрыть встречу из мессенджера. В трекере то же самое делает сама
// вкладка (статус — её колонка), поэтому там зовут только deliverRecap.
export async function closeMeeting(
  admin: SupabaseClient,
  meeting: MeetingRef,
  outcome: "success" | "no_result",
  result: string,
): Promise<void> {
  await admin
    .from("meetings")
    .update({
      status: outcome,
      result: mergeResult(meeting.result || "", result),
      resolved_at: new Date().toISOString(),
    })
    .eq("id", meeting.id);

  if (result.trim()) await deliverRecap(admin, meeting, result.trim());
  else {
    await recordEvent(admin, {
      userId: meeting.user_id,
      kind: "meeting",
      itemId: meeting.id,
      text: outcome === "success" ? "✅ Встреча закрыта" : "⚪ Встреча закрыта без результата",
    });
  }
}
