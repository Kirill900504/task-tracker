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

// Старые строки хроники — те, что успели записаться ролью до 20.09.2026, —
// лежат в базе как есть: «✅ Владелец принял работу: …». 14.10.2026 Кирилл
// увидел такую в задаче №50 («какой ещё „владелец“? указывай строго имя
// фамилия пользователя»). Владелец в пространстве один, поэтому слово
// однозначно переводится в имя — при показе, а не правкой базы: хроника
// пишется только маршрутом, и переписывать её задним числом незачем.
// «Постановщик» так не переводится: их много, и угадывать нельзя — но
// таких строк в базе и нет (проверено запросом 14.10.2026).
export function nameLegacyRole(text: string, ownerName: string): string {
  const name = withoutSelfMark(ownerName);
  if (!name) return text;
  return text.replace(/(^|\s)Владелец(?= (принял|вернул|закрыл|открыл|продлил|перенёс|отменил|назначил))/, `$1${name}`);
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
