import type { SupabaseClient } from "@supabase/supabase-js";

// Закрытое событие — только просмотр (14.10.2026, «запрети любые изменения
// или дополнения уже закрытых событий»). В трекере это держат интерфейс и
// политики базы (миграция 0056), но бот пишет служебным ключом, мимо
// политик, — поэтому его двери спрашивают здесь сами.
//
// «Закрыто» — то же правило, что у доски (lib/taskDisplay.isClosed) и у
// функции item_closed в базе: задача done или принятая разовая, встреча с
// исходом. Три копии одного правила — плата за три среды исполнения
// (браузер, сервер, Postgres); слова у них одни и те же нарочно.

type TaskRow = { status: string | null; recur: string | null; approval_state: string | null };
type MeetingRow = { status: string | null };

export function taskRowClosed(t: TaskRow): boolean {
  return t.status === "done" || ((t.recur || "none") === "none" && t.approval_state === "accepted");
}

export function meetingRowClosed(m: MeetingRow): boolean {
  return m.status === "success" || m.status === "no_result";
}

export async function itemClosed(admin: SupabaseClient, kind: "task" | "meeting", id: string): Promise<boolean> {
  if (kind === "task") {
    const { data } = await admin.from("tasks").select("status, recur, approval_state").eq("id", id).maybeSingle();
    return !!data && taskRowClosed(data as TaskRow);
  }
  const { data } = await admin.from("meetings").select("status").eq("id", id).maybeSingle();
  return !!data && meetingRowClosed(data as MeetingRow);
}

export function closedReply(kind: "task" | "meeting", title: string): string {
  const what = kind === "task" ? "Задача" : "Встреча";
  const back = kind === "task" ? "постановщик открывает её заново" : "организатор возвращает её в план";
  return `🔒 ${what}${title ? ` «${title}»` : ""} уже закрыта — обсуждение только для просмотра. Если нужно вернуться к ней, ${back}.`;
}
