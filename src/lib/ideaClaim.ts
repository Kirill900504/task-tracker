import type { SupabaseClient } from "@supabase/supabase-js";

// «Взять мысль в работу» заводит задачу ОДИН раз — сколько бы нажатий ни
// пришло (аудит 29.10.2026).
//
// Обе двери — кнопка в трекере (/api/workspace/report, take_idea) и кнопка
// в мессенджере (ideaInbox) — проверяли «не взята ли уже», потом заводили
// задачу и только потом помечали мысль взятой. Два нажатия в одну секунду
// (в Telegram и в трекере, или дребезг кнопки) оба проходили проверку, и у
// человека появлялись две одинаковые задачи. Пометка теперь условная: мысль
// занимает тот, кто пометил её ПЕРВЫМ, а проигравший убирает свою только что
// заведённую задачу и получает ту, что уже есть.
//
// Задача заводится до пометки, а не после, потому что converted_task_id —
// внешний ключ на tasks (миграция 0019): пометить мысль задачей, которой
// ещё нет, база не даст.
export async function claimTakenIdea(
  admin: SupabaseClient,
  match: { id: string } | { ideaId: string; assigneeId: string },
  taskId: string,
  now: string,
): Promise<{ taskId: string; won: boolean }> {
  let claim = admin.from("idea_recipients").update({ converted_task_id: taskId, seen_at: now });
  claim = "id" in match ? claim.eq("id", match.id) : claim.eq("idea_id", match.ideaId).eq("assignee_id", match.assigneeId);
  const { data } = await claim.is("converted_task_id", null).select("id");
  if ((data || []).length) return { taskId, won: true };

  // Опоздали: задача уже есть. Свою — мягко убрать (её ещё никто не видел,
  // и сообщение о ней никому не ушло), вернуть ту, что заведена первой.
  await admin.from("tasks").update({ deleted_at: now }).eq("id", taskId);
  let existing = admin.from("idea_recipients").select("converted_task_id");
  existing = "id" in match ? existing.eq("id", match.id) : existing.eq("idea_id", match.ideaId).eq("assignee_id", match.assigneeId);
  const { data: row } = await existing.not("converted_task_id", "is", null).limit(1).maybeSingle();
  return { taskId: (row as { converted_task_id?: string } | null)?.converted_task_id || taskId, won: false };
}
