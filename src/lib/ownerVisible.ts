import type { SupabaseClient } from "@supabase/supabase-js";

// Что из пространства видит его владелец — для сообщений, которые собирает
// сервер.
//
// Правило видимости одно и для экрана, и для бота (lib/itemVisibility,
// 23.09.2026, его слова: «это правило касается и меня!»): задача видна
// постановщику и её участникам, встреча — организатору и приглашённым.
// Экран его соблюдает с того же дня, а утренняя сводка владельца — нет:
// она читала задачи и встречи по `user_id`, то есть всё пространство
// целиком, и рассказывала ему про чужие поручения, чужие обсуждения и чужих
// молчащих — ровно ту «засорённость эфира», от которой правило и было.
// Найдено разбором оповещений 14.10.2026.
//
// «Своё» владельца — пустой `created_by` (lib/ownership), «участник» — его
// строка с пометкой «(я)» в списке людей.

export type OwnerSight = {
  selfRowId: string | null;
  selfName: string;
  // Задачи, где он участник (любая роль).
  taskIds: Set<string>;
};

export async function ownerSight(admin: SupabaseClient, ownerId: string): Promise<OwnerSight> {
  const { data: people } = await admin.from("assignees").select("id, name").eq("user_id", ownerId);
  const self = ((people || []) as { id: string; name: string }[]).find((p) => /\(я\)\s*$/.test(p.name));
  if (!self) return { selfRowId: null, selfName: "", taskIds: new Set() };
  const { data: parts } = await admin.from("task_participants").select("task_id").eq("assignee_id", self.id);
  return {
    selfRowId: self.id,
    selfName: self.name,
    taskIds: new Set(((parts || []) as { task_id: string }[]).map((p) => p.task_id)),
  };
}

export function ownerSeesTask(sight: OwnerSight, task: { id: string; created_by?: string | null }): boolean {
  return !task.created_by || sight.taskIds.has(task.id);
}

export function ownerSeesMeeting(sight: OwnerSight, meeting: { created_by?: string | null; participants?: string[] | null }): boolean {
  return !meeting.created_by || (!!sight.selfName && (meeting.participants || []).includes(sight.selfName));
}
