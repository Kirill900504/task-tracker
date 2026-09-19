import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatsFor, replyButtons, type ColleagueRow } from "@/lib/colleagues";
import { sendToColleague } from "@/lib/botDelivery";
import { recordEvent } from "@/lib/itemHistory";
import { fmtDate } from "@/lib/taskDisplay";

// Итог встречи — тем, кто на ней был.
//
// Организатора об итоге спрашивают через два часа после конца, напоминают
// через сутки и тянут в понедельничную сводку, если он так и не написал.
// Участникам при этом не уходило ничего — а итог и есть то единственное,
// ради чего половина из них приходила. Половина ещё и не пришла: «о чём
// договорились» они не узнавали вовсе.
//
// Маршрут, а не запись из вкладки, по той же причине, что и всё остальное
// здесь: сам итог принадлежит движку синхронизации и сохраняется им, а вот
// «кому сказать» — правило, и живёт оно на сервере, где его нельзя обойти.

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { meetingId?: string; result?: string } | null;
  const result = (body?.result || "").trim();
  if (!body?.meetingId || !result) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("meetings")
    .select("id, title, date, time, user_id, created_by, from_task_id")
    .eq("id", body.meetingId)
    .is("deleted_at", null)
    .maybeSingle();
  const meeting = row as {
    id: string;
    title: string;
    date: string;
    time: string | null;
    user_id: string;
    created_by: string | null;
    from_task_id: string | null;
  } | null;
  if (!meeting) return NextResponse.json({ error: "Встреча не найдена" }, { status: 404 });

  // Рассылает тот, чья это встреча: владелец пространства или тот, кто её
  // собрал. Иначе достаточно было бы знать id, чтобы разослать от их имени
  // что угодно.
  if (meeting.user_id !== user.id && meeting.created_by !== user.id) {
    return NextResponse.json({ error: "Это не ваша встреча" }, { status: 403 });
  }

  const { data: parts } = await admin
    .from("meeting_participants")
    .select("assignee_id")
    .eq("meeting_id", meeting.id);
  const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id);
  if (!ids.length) return NextResponse.json({ ok: true, sent: 0 });

  const { data: people } = await admin
    .from("assignees")
    .select("id, name, telegram_chat_id, max_user_id")
    .in("id", ids);

  const when = fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "");
  const text = `📝 Итог встречи «${meeting.title}» (${when}):\n\n${result}`;

  let sent = 0;
  for (const person of ((people || []) as ColleagueRow[])) {
    const target = chatsFor(person)[0];
    // Кнопка «Ответить» здесь не формальность: с итогом чаще всего и
    // спорят, и уточнять его будут именно в этот момент.
    if (target && (await sendToColleague(target, text, replyButtons("meeting", meeting.id))).ok) sent++;
  }

  await recordEvent(admin, { userId: meeting.user_id, kind: "meeting", itemId: meeting.id, text: `📝 Итог разослан участникам (${sent})` });

  // Встреча, выросшая из задачи, возвращает в неё ответ.
  //
  // Ради этого задачу и «перекидывали во встречу»: собрались, чтобы
  // сдвинуть её с места, — значит в самой задаче должно быть написано, чем
  // кончилось. Раньше итог оставался во встрече, а человек, открывший
  // задачу через неделю, видел только, что когда-то по ней собирались.
  //
  // Строкой в обсуждение, а не колонкой: история итема живёт там (правило
  // в CLAUDE.md), и участники задачи получат её обычной рассылкой.
  if (meeting.from_task_id) {
    await recordEvent(admin, {
      userId: meeting.user_id,
      kind: "task",
      itemId: meeting.from_task_id,
      text: `📝 Итог встречи «${meeting.title}» (${when}): ${result}`,
    });
  }

  return NextResponse.json({ ok: true, sent });
}
