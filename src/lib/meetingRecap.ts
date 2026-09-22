import type { SupabaseClient } from "@supabase/supabase-js";
import { replyButtons, type ColleagueRow } from "@/lib/colleagues";
import { sendToPerson } from "@/lib/reach";
import { recordEvent } from "@/lib/itemHistory";
import { mergeResult } from "@/lib/meetingLink";
import { fmtDate } from "@/lib/taskDisplay";
import { applyReview } from "@/lib/reviewWork";

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
  // Кто закрывает. Нужен только ради задачи, из которой встреча выросла:
  // принять по ней работу вправе постановщик, и в хронике должно стоять его
  // имя, а не слово «Постановщик». Без актора приёмка просто не случается —
  // это мягче, чем закрыть чужую работу от ничьего имени.
  who?: { label: string; userId: string },
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

  if (outcome === "success" && who) await approveTaskFromMeeting(admin, meeting, result, who);
}

// Встреча прошла успешно — значит задача, ради которой собирались, принята.
//
// Слова Кирилла 21.09.2026: «если мы перемещаем задачу из приёмки во встречу
// и встреча проходит успешно, тогда должно работать правило, что при
// успешно закрытой встрече автоматом… с таким же комментарием должна
// закрываться и задача из приёмки». Это не удобство: работу принимают
// разговором, а нажатие — всего лишь запись о нём. Пока записи не было,
// задача оставалась в «На приёмке» после встречи, на которой её как раз и
// приняли, и утренняя сводка спрашивала о ней снова.
//
// Три границы, и каждая из них нужна.
//
// *Только из «На приёмке».* Успешная встреча по задаче, которая ещё в
// работе, означает «договорились, как делать», а не «сделано», — и закрыть
// её значило бы отчитаться за исполнителя. Столбец считается здесь так же,
// как его считает доска (lib/kanban): либо приёмка уже объявлена, либо
// отчитались все исполнители. Вторая проверка обязательна: `awaiting_review`
// проставляет только ответ через маршрут, а «все отчитались» бывает и без
// него.
//
// *Только постановщиком.* Собрать встречу вправе каждый, принять работу —
// тот, кто её поручил. Встреча, собранная кем-то ещё, итог в задачу всё
// равно допишет (deliverRecap выше), но закрывать её не станет.
//
// *Комментарий тот же самый.* Два разных текста об одном решении расходятся,
// и человек, получивший «принято», потом не находит, за что именно.
export async function approveTaskFromMeeting(
  admin: SupabaseClient,
  meeting: MeetingRef,
  result: string,
  who: { label: string; userId: string },
): Promise<boolean> {
  if (!meeting.from_task_id) return false;

  const { data: row } = await admin
    .from("tasks")
    .select("id, title, user_id, created_by, approval_state, status")
    .eq("id", meeting.from_task_id)
    .is("deleted_at", null)
    .maybeSingle();
  const task = row as {
    id: string;
    title: string;
    user_id: string;
    created_by: string | null;
    approval_state: string | null;
    status: string | null;
  } | null;
  if (!task) return false;

  // Уже закрыта — второй раз «принято» не говорят: исполнителю ушло бы
  // второе сообщение об одном и том же решении.
  if (task.status === "done" || task.approval_state === "accepted") return false;
  if (who.userId !== task.user_id && who.userId !== task.created_by) return false;

  if (task.approval_state !== "awaiting_review") {
    const { data: parts } = await admin
      .from("task_participants")
      .select("done_at")
      .eq("task_id", task.id)
      .eq("role", "executor");
    const executors = (parts || []) as { done_at: string | null }[];
    if (!executors.length || executors.some((p) => !p.done_at)) return false;
  }

  // Пустой итог оставил бы исполнителя с голым «✅ Принято» без единого
  // слова о том, откуда это взялось, — а взялось оно со встречи, на которой
  // его самого могло и не быть.
  const comment = result.trim() || `Принято по итогам встречи «${meeting.title}»`;
  const done = await applyReview(admin, { id: task.id, title: task.title, user_id: task.user_id }, "approve", comment, who);
  return done.ok;
}
