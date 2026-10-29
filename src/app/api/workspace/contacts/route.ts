import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isServiceEmail } from "@/lib/cabinet";

// Рабочие почта и телефон людей — в карточке человека в «Команде».
//
// Только владельцу (isOwner): «Команда» его, и связаться с человеком,
// который не отвечает в боте, — его же забота. Остальным эти столбцы не
// отдаются вовсе: телефон в браузер не открыт (миграция 0071), а почта
// живёт в учётной записи, которую браузер чужого человека не читает.
// Сами люди вносят их в «Моих данных» (/api/account/credentials).

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const admin = createAdminClient();
  // Владелец — тот, чьё пространство: строки людей с его user_id.
  const [{ data: people }, { data: members }] = await Promise.all([
    admin.from("assignees").select("id, phone").eq("user_id", user.id).is("archived_at", null),
    admin.from("workspace_members").select("assignee_id, member_id").eq("owner_id", user.id),
  ]);
  if (!people?.length) return NextResponse.json({ error: "Это решение не ваше" }, { status: 403 });

  const contacts: Record<string, { phone: string; email: string }> = {};
  for (const p of people as { id: string; phone: string | null }[]) contacts[p.id] = { phone: p.phone || "", email: "" };
  // Почта владельца — его собственная, на строке «(я)» её показывать
  // незачем: он и так знает, под чем входит.
  await Promise.all(
    ((members || []) as { assignee_id: string; member_id: string | null }[])
      .filter((m) => m.member_id && contacts[m.assignee_id])
      .map(async (m) => {
        const { data } = await admin.auth.admin.getUserById(m.member_id!);
        const email = data?.user?.email || "";
        if (!isServiceEmail(email)) contacts[m.assignee_id].email = email;
      }),
  );
  return NextResponse.json({ contacts }, { headers: { "Cache-Control": "no-store" } });
}
