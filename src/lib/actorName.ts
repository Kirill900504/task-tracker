import type { SupabaseClient } from "@supabase/supabase-js";
import { isSelfAssignee } from "@/lib/trackerRows";

// Как зовут того, кто принял решение.
//
// Строки хроники писались ролью: «Владелец принял работу», «Постановщик
// вернул на доработку». В трекере на одного человека это читалось, в
// трекере на четырнадцать — нет: постановщиков много, и «постановщик
// вернул» не отвечает на единственный вопрос, который к этой строке
// задают, — кто именно. Слова Кирилла 20.09.2026 о позиционировании:
// участники равноправны, роль у них по задаче, а не по месту в системе.
// Значит роль называется ролью, а человек — именем.
//
// Имя ищется там же, где его находит трекер (useAuthors): строка членства
// ведёт на строку человека. У владельца членства нет — его строка помечена
// «(я)».

// Пометка «(я)» в списке людей нужна владельцу, чтобы найти себя среди
// четырнадцати. В чужой хронике и в чужом мессенджере она бессмысленна:
// читает это не он.
export function withoutSelfMark(name: string): string {
  return name.replace(/\s*\(я\)\s*$/i, "").trim();
}

export async function actorName(
  admin: SupabaseClient,
  workspaceOwnerId: string,
  userId: string,
  fallback = "Постановщик",
): Promise<string> {
  if (userId === workspaceOwnerId) {
    const { data } = await admin.from("assignees").select("name").eq("user_id", workspaceOwnerId);
    const own = ((data || []) as { name: string }[]).find((a) => isSelfAssignee(a.name));
    return (own ? withoutSelfMark(own.name) : "") || fallback;
  }

  const { data } = await admin
    .from("workspace_members")
    .select("assignees(name)")
    .eq("owner_id", workspaceOwnerId)
    .eq("member_id", userId)
    .maybeSingle();
  const row = data as { assignees: { name: string } | { name: string }[] | null } | null;
  const name = row ? (Array.isArray(row.assignees) ? row.assignees[0]?.name : row.assignees?.name) : "";
  return withoutSelfMark(name || "") || fallback;
}
