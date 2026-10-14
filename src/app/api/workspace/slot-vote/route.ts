import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSelfAssignee } from "@/lib/trackerRows";
import { chooseSlot, recordSlotVote } from "@/lib/meetingPoll";

// Опрос времени встречи из трекера (миграция 0062, lib/meetingPoll).
//
//   { meetingId, slots: [0, 2] } — какие варианты подходят мне;
//   { meetingId, choose: 1 }     — организатор назначает вариант сам.
//
// Голос пишет маршрут, а не браузер: после каждого голоса надо проверить,
// не ответили ли все, и назначить встречу — правило одно на трекер и бота.

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { meetingId?: string; slots?: unknown; choose?: unknown } | null;
  if (!body?.meetingId) return NextResponse.json({ error: "Не указана встреча" }, { status: 400 });

  // Под входом человека: политики видимости пускают к встрече только тех,
  // кого она касается, — это и граница права голосовать.
  const { data: visible } = await supabase.from("meetings").select("id, user_id").eq("id", body.meetingId).maybeSingle();
  if (!visible) return NextResponse.json({ error: "Встреча не найдена" }, { status: 404 });
  const spaceId = (visible as { user_id: string }).user_id;
  const admin = createAdminClient();

  if (body.choose !== undefined) {
    const result = await chooseSlot(admin, body.meetingId, Number(body.choose), user.id);
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: 409 });
  }

  // Моя строка в списке людей этого пространства: у владельца — «(я)», у
  // остальных — по членству.
  let assigneeId = "";
  if (spaceId === user.id) {
    const { data } = await admin.from("assignees").select("id, name").eq("user_id", spaceId);
    assigneeId = ((data || []) as { id: string; name: string }[]).find((a) => isSelfAssignee(a.name))?.id || "";
  } else {
    const { data } = await admin
      .from("workspace_members")
      .select("assignee_id")
      .eq("owner_id", spaceId)
      .eq("member_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    assigneeId = (data as { assignee_id?: string } | null)?.assignee_id || "";
  }
  if (!assigneeId) return NextResponse.json({ error: "Вас нет в списке людей этого трекера" }, { status: 403 });

  const result = await recordSlotVote(admin, body.meetingId, assigneeId, Array.isArray(body.slots) ? (body.slots as number[]) : []);
  return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: 409 });
}
