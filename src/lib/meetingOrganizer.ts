import type { SupabaseClient } from "@supabase/supabase-js";
import { isSelfAssignee } from "@/lib/trackerRows";

// Имя организатора — так, как оно стоит в составе встречи.
//
// Организатор — это `created_by`, а не владелец пространства. Пустой
// created_by (или сам владелец) — это строка «(я)»; руководитель находится
// через членство. Нужно затем, чтобы организатора не спрашивали, придёт ли
// он на собственную встречу, и не считали молчащим (lib/meetingVotes,
// withOrganizer). Серверная пара к authorRawName в lib/authorName: там те
// же два шага, только членство уже прочитано useAuthors.
export async function organizerName(
  admin: SupabaseClient,
  ownerId: string,
  createdBy: string | null | undefined,
  participants: string[],
): Promise<string> {
  if (!createdBy || createdBy === ownerId) return participants.find((p) => isSelfAssignee(p)) || "";
  const { data } = await admin
    .from("workspace_members")
    .select("assignees(name)")
    .eq("member_id", createdBy)
    .eq("owner_id", ownerId)
    .maybeSingle();
  const a = (data as { assignees?: { name: string } | { name: string }[] | null } | null)?.assignees;
  return (Array.isArray(a) ? a[0]?.name : a?.name) || "";
}
