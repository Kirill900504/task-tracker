import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { awayInput, readInput } from "@/lib/apiInput";
import { isSelfAssignee } from "@/lib/trackerRows";

// Отметить отсутствие: «в отпуске до 15.10» (миграция 0047).
//
// Себя отмечает каждый — это его собственная новость, и уходящий в отпуск
// не должен просить об этом владельца. Другого — только владелец
// пространства: список людей у него, и он же узнаёт, что человек слёг,
// раньше, чем тот доберётся до трекера. Пишет маршрут, служебным ключом:
// из браузера строку человека правит только владелец (миграция 0031), а
// разрешать остальным UPDATE ради двух колонок значило бы разрешить и имя.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: body, error: badInput } = await readInput(req, awayInput);
  if (badInput) return badInput;

  const admin = createAdminClient();
  const { data: row } = await admin.from("assignees").select("id, user_id, name").eq("id", body.assigneeId).maybeSingle();
  const person = row as { id: string; user_id: string; name: string } | null;
  if (!person) return NextResponse.json({ error: "Человек не найден" }, { status: 404 });

  const isOwner = person.user_id === user.id;
  let isSelf = isOwner && isSelfAssignee(person.name);
  if (!isOwner) {
    const { data: member } = await admin
      .from("workspace_members")
      .select("assignee_id, status")
      .eq("owner_id", person.user_id)
      .eq("member_id", user.id)
      .maybeSingle();
    isSelf = !!member && member.status !== "disabled" && member.assignee_id === person.id;
  }
  if (!isOwner && !isSelf) return NextResponse.json({ error: "Отметить можно только себя" }, { status: 403 });

  const patch = body.until ? { away_until: body.until, away_kind: body.kind || "other" } : { away_until: null, away_kind: null };
  const { error } = await admin.from("assignees").update(patch).eq("id", person.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
