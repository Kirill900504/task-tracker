import type { SupabaseClient } from "@supabase/supabase-js";
import { chatsFor, type ColleagueRow } from "@/lib/colleagues";
import { ownerChats, type OwnerChat } from "@/lib/botDelivery";

// Куда писать ВЛАДЕЛЬЦУ ВХОДА — о самом входе: ссылка на новый пароль, «ваш
// пароль изменён».
//
// Один чат, выбранный человеком (MAX по умолчанию), и только действующему
// участнику: у отключённого входа нет, и слать ему ссылку на новый пароль
// значило бы возвращать доступ мимо владельца. Жило это внутри «Забыли
// пароль?»; вынесено 29.10.2026, когда о смене пароля стало нужно говорить
// и из «Моих данных» — второй копией правило разошлось бы с первой.
//
// Строки членства нет — это владелец собственного пространства: его чат
// живёт в учётной записи, а не в строке списка людей (см. lib/reach).
export async function accountChat(admin: SupabaseClient, userId: string): Promise<OwnerChat | null> {
  const { data: membership } = await admin
    .from("workspace_members")
    .select("assignee_id, status")
    .eq("member_id", userId)
    .limit(1)
    .maybeSingle();
  if (!membership) {
    const { data: mine } = await admin.from("assignees").select("id").eq("user_id", userId).limit(1);
    if (!(mine || []).length) return null;
    return (await ownerChats(admin, userId))[0] ?? null;
  }
  if (membership.status !== "active") return null;
  const { data: person } = await admin
    .from("assignees")
    .select("id, name, telegram_chat_id, max_user_id, messenger")
    .eq("id", membership.assignee_id)
    .maybeSingle();
  return person ? chatsFor(person as ColleagueRow)[0] ?? null : null;
}
