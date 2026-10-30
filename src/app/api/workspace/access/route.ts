import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rateLimit";
import { setAccessBan } from "@/lib/accessBan";

// «Отключить вход» / «Вернуть вход» в «Команде» — дело владельца (isOwner).
//
// До 30.10.2026 это была запись строки членства прямо из браузера, и она
// делала половину работы: данные закрывала RLS, а сама учётная запись
// оставалась живой. Сессия отключённого продолжала обновляться на каждом
// его устройстве, а живая ссылка-приглашение подключала ему новый чат.
// Теперь маршрут делает всё сразу: членство, запрет входа на сервере входа
// (lib/accessBan — сессии больше не обновляются, вход любым путём
// отказывает) и уборку неиспользованных ссылок.

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const admin = createAdminClient();
  const { allowed } = await checkRateLimit(admin, user.id, "workspace-access", 30, 600);
  if (!allowed) return NextResponse.json({ error: "Слишком много изменений подряд, подождите немного" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { assigneeId?: unknown; active?: unknown } | null;
  const assigneeId = typeof body?.assigneeId === "string" ? body.assigneeId : "";
  if (!assigneeId || typeof body?.active !== "boolean") return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });
  const active = body.active;

  const { data: person } = await admin.from("assignees").select("id, user_id, name").eq("id", assigneeId).maybeSingle();
  if (!person || person.user_id !== user.id) return NextResponse.json({ error: "Это решение не ваше" }, { status: 403 });
  if (/\(я\)\s*$/.test(person.name as string)) return NextResponse.json({ error: "Свой вход отключить нельзя" }, { status: 400 });

  const { data: member } = await admin
    .from("workspace_members")
    .select("id, member_id")
    .eq("owner_id", user.id)
    .eq("assignee_id", assigneeId)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "У этого человека нет входа в трекер" }, { status: 404 });

  const { error } = await admin
    .from("workspace_members")
    .update(active ? { status: "active", disabled_at: null } : { status: "disabled", disabled_at: new Date().toISOString() })
    .eq("id", member.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (member.member_id) {
    const banned = await setAccessBan(admin, member.member_id as string, !active);
    if (!banned.ok) return NextResponse.json({ error: "Доступ отмечен, но сервер входа не ответил: " + banned.error }, { status: 500 });
  }
  if (!active) {
    await Promise.all([
      admin.from("workspace_invites").delete().eq("assignee_id", assigneeId).is("used_at", null),
      admin.from("telegram_link_codes").delete().eq("assignee_id", assigneeId),
    ]);
  }
  return NextResponse.json({ ok: true });
}
