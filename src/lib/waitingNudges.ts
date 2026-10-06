import type { SupabaseClient } from "@supabase/supabase-js";

// Задача, которую не взяли, и работа, которую не принимают, — подают голос
// по часам, а не только по сроку.
//
// Отзыв Витовского 25.09.2026: «при постановке задач должно приходить
// уведомление, если задача не берётся в работу N кол-во часов. То же самое
// касается и приёмки… если её не принимают долго, пусть будет уведомление».
// Ступени просрочки (lib/escalation) молчат до самого срока, а у задачи без
// срока молчат всегда — «отправлено, ещё не приняли» могло висеть неделю, и
// узнавал об этом только тот, кто откроет карточку.
//
// Два напоминания, оба — один раз на задачу (onceOnly в кроне):
//   * исполнителю — если за ACCEPT_AFTER_H часов он не ответил ничего:
//     ни «Принял», ни «Не могу», ни отчёта;
//   * постановщику — если работа лежит на приёмке REVIEW_AFTER_H часов.
// Только по свежему: задача, поставленная месяц назад и так и не принятая,
// в день выкладки этого правила иначе разбудила бы всех разом, и первое
// же напоминание прочли бы как спам.

export const ACCEPT_AFTER_H = 4;
export const REVIEW_AFTER_H = 24;
// Старше этого — уже не «долго не берут», а забытое; о нём говорят
// утренняя сводка и ступени просрочки.
export const FRESH_FOR_H = 72;

const H = 3600_000;

// Пора ли напомнить: прошло не меньше `after` часов и не больше FRESH_FOR_H.
export function isDue(sinceIso: string | null | undefined, nowMs: number, afterH: number): boolean {
  const since = Date.parse(sinceIso || "");
  if (Number.isNaN(since)) return false;
  const age = nowMs - since;
  return age >= afterH * H && age <= FRESH_FOR_H * H;
}

export type Unaccepted = { taskId: string; title: string; participantId: string; assigneeId: string };
export type Unreviewed = { taskId: string; title: string; createdBy: string | null; since: string };

export async function findWaiting(
  admin: SupabaseClient,
  userId: string,
  nowMs: number,
): Promise<{ unaccepted: Unaccepted[]; unreviewed: Unreviewed[] }> {
  const { data } = await admin
    .from("task_participants")
    .select("id, task_id, assignee_id, role, created_at, accepted_at, done_at, declined_at, tasks(title, created_by, status, approval_state, deleted_at)")
    .eq("user_id", userId)
    .eq("role", "executor");
  type TaskRef = { title: string; created_by: string | null; status: string | null; approval_state: string | null; deleted_at: string | null };
  type Row = {
    id: string;
    task_id: string;
    assignee_id: string;
    created_at: string;
    accepted_at: string | null;
    done_at: string | null;
    declined_at: string | null;
    tasks: TaskRef | TaskRef[] | null;
  };
  const rows = (data || []) as unknown as Row[];

  const unaccepted: Unaccepted[] = [];
  const reviewSince = new Map<string, Unreviewed>();
  for (const r of rows) {
    const t = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks;
    if (!t || t.deleted_at || t.status === "done" || t.approval_state === "accepted") continue;
    if (!r.accepted_at && !r.done_at && !r.declined_at && isDue(r.created_at, nowMs, ACCEPT_AFTER_H)) {
      unaccepted.push({ taskId: r.task_id, title: t.title, participantId: r.id, assigneeId: r.assignee_id });
    }
    if (t.approval_state === "awaiting_review") {
      // На приёмке — с последнего ответа: пока отвечали не все, ждали не
      // постановщика.
      const answered = [r.done_at, r.declined_at].filter(Boolean).sort().pop() || "";
      const prev = reviewSince.get(r.task_id);
      if (!prev || answered > prev.since) reviewSince.set(r.task_id, { taskId: r.task_id, title: t.title, createdBy: t.created_by, since: answered });
    }
  }
  const unreviewed = [...reviewSince.values()].filter((u) => isDue(u.since, nowMs, REVIEW_AFTER_H));
  return { unaccepted, unreviewed };
}

export function unacceptedText(title: string): string {
  return `⏳ Задача «${title}» ждёт вашего ответа уже больше ${ACCEPT_AFTER_H} часов.\n\nВзялись — «Принял», не получится — «Не могу». Одной кнопки достаточно.`;
}

export function unreviewedText(title: string): string {
  return `⏳ Работа по задаче «${title}» ждёт вашей приёмки больше суток.\n\nПримите или верните с объяснением — исполнитель ждёт вашего слова.`;
}
