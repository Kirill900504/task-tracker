import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordEvent } from "@/lib/itemHistory";
import { actorName } from "@/lib/actorName";
import { notifyAuthor } from "@/lib/botDelivery";
import { recapButtons } from "@/lib/meetingReminders";
import { recapNudgeText } from "@/lib/meetingNudges";
import { RECAP_GRACE_MINUTES } from "@/lib/calendarLogic";
import { moscowNow } from "@/lib/taskLogic";

// Участник просит организатора подвести итог прошедшей встречи.
//
// Слова Кирилла 07.10.2026: «это для участников встречи, так как сами то
// они прошедшие встречи скрыть не могут». Итог — право того, кто собрал
// (как перенос и отмена), и до сих пор участник с плашкой «нужен итог» мог
// только ждать, пока организатор вспомнит сам. Теперь одна кнопка — и
// организатору в мессенджер приходит шутка с теми же кнопками итога, что
// присылает крон: закрыть можно, не открывая трекер.
//
// Строка в обсуждении встречи — не украшение, а две вещи сразу: остальные
// участники видят, что напомнили уже (и не жмут следом), а маршрут по ней
// же отказывает в повторе раньше трёх часов. Иначе четырнадцать человек,
// каждый по разу, — это четырнадцать одинаковых сообщений подряд.

const NUDGE_MARK = "🔔";
const QUIET_HOURS = 3;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { meetingId?: string } | null;
  if (!body?.meetingId) return NextResponse.json({ error: "Не указана встреча" }, { status: 400 });

  // Читается ПОД ВХОДОМ человека: политики видимости пускают к встрече
  // только тех, кого она касается, и это же граница права напомнить —
  // посторонний встречу просто не найдёт.
  const { data: visible } = await supabase.from("meetings").select("id").eq("id", body.meetingId).maybeSingle();
  if (!visible) return NextResponse.json({ error: "Встреча не найдена" }, { status: 404 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("meetings")
    .select("id, title, date, time, status, result, user_id, created_by")
    .eq("id", body.meetingId)
    .maybeSingle();
  const meeting = data as {
    id: string;
    title: string;
    date: string | null;
    time: string | null;
    status: string | null;
    result: string | null;
    user_id: string;
    created_by: string | null;
  } | null;
  if (!meeting) return NextResponse.json({ error: "Встреча не найдена" }, { status: 404 });

  const organizer = meeting.created_by || meeting.user_id;
  if (organizer === user.id) return NextResponse.json({ error: "Это ваша встреча — итог за вами" }, { status: 400 });

  // То же условие, что у плашки «нужен итог» (awaitsRecap), но по
  // московским часам: функция на сервере живёт в UTC.
  if ((meeting.status && meeting.status !== "planned") || meeting.result || !meeting.date) {
    return NextResponse.json({ error: "У встречи уже есть итог" }, { status: 409 });
  }
  const [hh, mm] = (meeting.time || "23:59").split(":").map(Number);
  const startUtcMs = Date.parse(meeting.date + "T00:00:00Z") + ((hh || 0) * 60 + (mm || 0)) * 60_000;
  if (moscowNow().getTime() - startUtcMs < RECAP_GRACE_MINUTES * 60_000) {
    return NextResponse.json({ error: "Встреча ещё не закончилась" }, { status: 409 });
  }

  const since = new Date(Date.now() - QUIET_HOURS * 60 * 60_000).toISOString();
  const { data: recent } = await admin
    .from("item_comments")
    .select("created_at")
    .eq("item_kind", "meeting")
    .eq("item_id", meeting.id)
    .eq("system", true)
    .like("body", NUDGE_MARK + "%")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const last = (recent || [])[0] as { created_at: string } | undefined;
  if (last) {
    const minutes = Math.max(1, Math.round((Date.now() - Date.parse(last.created_at)) / 60_000));
    return NextResponse.json({ ok: true, already: true, minutes });
  }

  const who = await actorName(admin, meeting.user_id, user.id, "Участник");
  const text = recapNudgeText(meeting.title, who, meeting.id + who);
  await Promise.all([
    notifyAuthor(admin, meeting.user_id, meeting.created_by, text, undefined, recapButtons(meeting.id)),
    recordEvent(admin, { userId: meeting.user_id, kind: "meeting", itemId: meeting.id, text: `${NUDGE_MARK} ${who} напомнил об итоге встречи` }),
  ]);
  return NextResponse.json({ ok: true });
}
