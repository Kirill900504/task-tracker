import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordEvent } from "@/lib/itemHistory";
import { sendToPerson } from "@/lib/reach";
import { actorName } from "@/lib/actorName";
import { fmtDate } from "@/lib/taskDisplay";
import type { ColleagueRow } from "@/lib/colleagues";

// Отмена встречи — с причиной, и о ней узнают те, кого звали.
//
// Отзыв Витовского 25.09.2026: «удалять встречу вот так просто нельзя через
// крестик… любая отмена должна нести какую-то причину. Хочешь отменить
// встречу? Жмёшь крест и пишешь почему». До этого крестик удалял встречу
// молча: у участников она оставалась в планах, кнопки «Буду / Не смогу» в
// мессенджере продолжали висеть, а узнавали они об отмене, придя в
// переговорную.
//
// Сама встреча удаляется движком синхронизации (мягкое удаление — его
// колонка), а здесь живёт правило «кому сказать и что записать». Вкладка
// зовёт маршрут, когда истекло время на «Отменить» во всплывашке: иначе
// отмена, отменённая через секунду, уже успела бы уйти людям.

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { meetingId?: string; reason?: string } | null;
  const reason = (body?.reason || "").trim();
  if (!body?.meetingId || !reason) return NextResponse.json({ error: "Нужна причина отмены" }, { status: 400 });

  const admin = createAdminClient();
  // Без фильтра по deleted_at: к этой минуте встреча уже удалена вкладкой.
  const { data: row } = await admin
    .from("meetings")
    .select("id, title, date, time, user_id, created_by, status")
    .eq("id", body.meetingId)
    .maybeSingle();
  const meeting = row as {
    id: string;
    title: string;
    date: string;
    time: string | null;
    user_id: string;
    created_by: string | null;
    status: string | null;
  } | null;
  if (!meeting) return NextResponse.json({ error: "Встреча не найдена" }, { status: 404 });
  // Отменяет тот, кто назначил (у владельца created_by пуст) — то же
  // правило, что в интерфейсе: чужую встречу не удалить и не перенести.
  const author = meeting.created_by || meeting.user_id;
  if (author !== user.id) return NextResponse.json({ error: "Это не ваша встреча" }, { status: 403 });

  const who = await actorName(admin, meeting.user_id, user.id);
  const when = fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "");
  await recordEvent(admin, { userId: meeting.user_id, kind: "meeting", itemId: meeting.id, text: `🚫 ${who} отменил встречу: ${reason}` });

  // Прошедшую встречу «отменить» — это убрать запись, а не сообщить
  // людям: они на ней уже были (или не были), и письмо об отмене вчерашнего
  // читается как ошибка бота.
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  if (meeting.date < today || (meeting.status && meeting.status !== "planned" && meeting.status !== "proposed")) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const { data: parts } = await admin.from("meeting_participants").select("assignee_id").eq("meeting_id", meeting.id);
  const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id);
  let sent = 0;
  if (ids.length) {
    const { data: people } = await admin.from("assignees").select("id, name, telegram_chat_id, max_user_id").in("id", ids);
    // Без кнопок: отвечать на отмену нечем, а «Буду» под ней читалось бы
    // как вопрос. Всем сразу, а не по очереди.
    const delivered = await Promise.all(
      ((people || []) as ColleagueRow[]).map((person) =>
        sendToPerson(admin, meeting.user_id, person, `🚫 Встреча «${meeting.title}» (${when}) отменена.\n\n${who}: ${reason}`),
      ),
    );
    sent = delivered.filter(Boolean).length;
  }
  return NextResponse.json({ ok: true, sent });
}
