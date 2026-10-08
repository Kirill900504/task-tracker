import type { SupabaseClient } from "@supabase/supabase-js";
import { isSelfAssignee } from "@/lib/trackerRows";

// «Своя ли это задача» — то же правило, что lib/selfTask, только на сервере,
// где нет «меня»: здесь «я» — это постановщик задачи.
//
// Своя = на задаче нет никого, кроме её постановщика (в любой роли). Крону
// напоминаний это нужно, чтобы не разговаривать с человеком его же
// задачей как чужой: «ждёт вашего ответа — Принял / Не могу» и «просрочена,
// ответа нет, ждём: <он сам>» по задаче, которую он поставил себе, — шум,
// которого в трекере для своих задач нет уже нигде (07.10.2026).
//
// Строка постановщика: у руководителя — по членству (member_id → assignee_id),
// у владельца (created_by пуст) — по метке «(я)» в имени, как в lib/reach.

export type SelfTaskInput = {
  tasks: { id: string; created_by: string | null }[];
  participants: { task_id: string; assignee_id: string; name: string }[];
  members: { member_id: string; assignee_id: string | null }[];
};

// Чистая половина — чтобы её можно было проверить без базы.
export function pickSelfTasks({ tasks, participants, members }: SelfTaskInput): Set<string> {
  const assigneeOf = new Map(members.map((m) => [m.member_id, m.assignee_id || ""]));
  const byTask = new Map<string, { assignee_id: string; name: string }[]>();
  for (const p of participants) {
    const list = byTask.get(p.task_id) || [];
    list.push(p);
    byTask.set(p.task_id, list);
  }
  const out = new Set<string>();
  for (const t of tasks) {
    const people = byTask.get(t.id) || [];
    if (!people.length) continue;
    const mine = t.created_by
      ? (() => {
          const me = assigneeOf.get(t.created_by!) || "";
          return (p: { assignee_id: string }) => !!me && p.assignee_id === me;
        })()
      : (p: { name: string }) => isSelfAssignee(p.name || "");
    if (people.every(mine)) out.add(t.id);
  }
  return out;
}

export async function selfTaskIds(admin: SupabaseClient, ownerId: string, taskIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(taskIds)];
  if (!ids.length) return new Set();
  const [{ data: tasks }, { data: parts }, { data: members }] = await Promise.all([
    admin.from("tasks").select("id, created_by").in("id", ids),
    admin.from("task_participants").select("task_id, assignee_id, assignees(name)").in("task_id", ids),
    admin.from("workspace_members").select("member_id, assignee_id").eq("owner_id", ownerId),
  ]);
  type PRow = { task_id: string; assignee_id: string; assignees: { name: string } | { name: string }[] | null };
  return pickSelfTasks({
    tasks: (tasks || []) as SelfTaskInput["tasks"],
    participants: ((parts || []) as unknown as PRow[]).map((p) => ({
      task_id: p.task_id,
      assignee_id: p.assignee_id,
      name: (Array.isArray(p.assignees) ? p.assignees[0]?.name : p.assignees?.name) || "",
    })),
    members: (members || []) as SelfTaskInput["members"],
  });
}
