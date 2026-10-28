import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { messengerInput, readInput } from "@/lib/apiInput";
import { preferredMessenger } from "@/lib/colleagues";

// Куда писать мне — MAX или Telegram (миграция 0069).
//
// 28.10.2026: «возможность выбрать только один бот, приоритетный конечно
// MAX, но и телеграмм должен быть доступен для выбора». Выбирает человек
// сам и только за себя: это его телефон и его привычка, а не свойство
// пространства. Пишет маршрут служебным ключом — из браузера строку
// человека правит только владелец (миграция 0031), а разрешать остальным
// UPDATE ради одной колонки значило бы разрешить и имя.

// Своя строка в списке людей: у руководителя — по членству, у владельца —
// строка «(я)» (чаты у него на учётной записи, но человек — эта строка).
async function ownRow(admin: SupabaseClient, userId: string): Promise<{ id: string; messenger: string | null } | null> {
  const { data: member } = await admin
    .from("workspace_members")
    .select("assignee_id, status")
    .eq("member_id", userId)
    .neq("status", "disabled")
    .limit(1)
    .maybeSingle();
  const assigneeId = (member as { assignee_id?: string | null } | null)?.assignee_id;
  const query = assigneeId
    ? admin.from("assignees").select("id, messenger").eq("id", assigneeId)
    : admin.from("assignees").select("id, messenger").eq("user_id", userId).like("name", "%(я)").order("created_at").limit(1);
  const { data } = await query.maybeSingle();
  return (data as { id: string; messenger: string | null } | null) ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const row = await ownRow(createAdminClient(), user.id);
  return NextResponse.json({ messenger: preferredMessenger(row?.messenger) });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: body, error: badInput } = await readInput(req, messengerInput);
  if (badInput) return badInput;

  const admin = createAdminClient();
  const row = await ownRow(admin, user.id);
  if (!row) return NextResponse.json({ error: "Вас нет в списке людей трекера" }, { status: 404 });
  const { error } = await admin.from("assignees").update({ messenger: body.messenger }).eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, messenger: body.messenger });
}
