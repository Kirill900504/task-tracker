import { createAdminClient } from "@/lib/supabase/admin";
import { buildIcs, verifyCalendarToken, type FeedMeeting } from "@/lib/calendarFeed";
import { isSelfAssignee } from "@/lib/trackerRows";

// Календарь встреч человека по личной ссылке — его читает приложение
// «Календарь» телефона, без сессии и без браузера (см. lib/calendarFeed).
//
// Что в нём — то же, что человек видит в трекере (видимость по участию,
// 23.09.2026): встречи, которые он назначил сам, и те, куда его позвали.
// Чужого пространства и чужих встреч здесь не бывает: выборка всегда идёт
// по пространству, в котором он состоит, и по его строке участия.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const secret = process.env.CALENDAR_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const userId = secret ? verifyCalendarToken(token, secret) : null;
  if (!userId) return new Response("not found", { status: 404 });

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("workspace_members")
    .select("owner_id, assignee_id")
    .eq("member_id", userId)
    .eq("status", "active")
    .maybeSingle();
  let spaceId = userId;
  let assigneeId = "";
  if (member) {
    spaceId = member.owner_id as string;
    assigneeId = (member.assignee_id as string) || "";
  } else {
    const { data: people } = await admin.from("assignees").select("id, name").eq("user_id", userId);
    assigneeId = (((people || []) as { id: string; name: string }[]).find((p) => isSelfAssignee(p.name))?.id as string) || "";
  }

  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const invited = assigneeId
    ? (((await admin.from("meeting_participants").select("meeting_id").eq("assignee_id", assigneeId)).data || []) as { meeting_id: string }[]).map((r) => r.meeting_id)
    : [];
  // Своё — по автору (у владельца автор не записан), плюс приглашения.
  const mine = member ? `created_by.eq.${userId}` : "created_by.is.null";
  const filter = invited.length ? `${mine},id.in.(${invited.join(",")})` : mine;
  const { data: rows } = await admin
    .from("meetings")
    .select("id, title, date, time, duration_min, participants, status, result")
    .eq("user_id", spaceId)
    .is("deleted_at", null)
    .in("status", ["planned", "proposed", "success", "no_result"])
    .gte("date", since)
    .or(filter)
    .order("date");

  const meetings: FeedMeeting[] = ((rows || []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    title: (r.title as string) || "",
    date: r.date as string,
    time: (r.time as string) || null,
    durationMin: (r.duration_min as number) || null,
    participants: ((r.participants as string[]) || []).map((n) => n.replace(/\s*\(я\)\s*$/i, "")),
    status: (r.status as string) || null,
    result: (r.result as string) || null,
  }));

  return new Response(buildIcs(meetings), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="rokas-meetings.ics"',
      // Календари перечитывают подписку сами (обычно раз в час-сутки);
      // держать её у себя дольше пяти минут промежуточным узлам незачем.
      "Cache-Control": "private, max-age=300",
    },
  });
}
