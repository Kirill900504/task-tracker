import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveTaskFromMeeting, deliverRecap } from "@/lib/meetingRecap";
import { actorName } from "@/lib/actorName";

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

  // `outcome` появился вместе с правилом «успешная встреча принимает свою
  // задачу»: чем именно кончилась встреча, знает только вкладка — статус
  // принадлежит движку синхронизации и сюда не пишется. Поэтому же итог
  // больше не обязателен: встречу закрывают и молча, а задача из «На
  // приёмке» закрыться при этом всё равно должна.
  const body = (await req.json().catch(() => null)) as
    | { meetingId?: string; result?: string; outcome?: "success" | "no_result" }
    | null;
  const result = (body?.result || "").trim();
  const outcome = body?.outcome;
  if (!body?.meetingId || (!result && !outcome)) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });

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

  // Кому сказать, куда записать и что вернуть в задачу — правила, и
  // живут они в lib/meetingRecap: те же итоги закрываются теперь кнопкой
  // в мессенджере, и второй экземпляр этих правил разошёлся бы с первым.
  const ref = {
    id: meeting.id,
    title: meeting.title,
    date: meeting.date,
    time: meeting.time,
    user_id: meeting.user_id,
    from_task_id: meeting.from_task_id,
  };
  const sent = result ? await deliverRecap(admin, ref, result) : 0;

  // Задача, ради которой собирались, закрывается тем же решением и теми же
  // словами. Правило целиком — в approveTaskFromMeeting; здесь только имя
  // того, кто его применил: хроника подписывается именем, а не должностью.
  const closedTask =
    outcome === "success" &&
    (await approveTaskFromMeeting(admin, ref, result, {
      label: await actorName(admin, meeting.user_id, user.id),
      userId: user.id,
    }));

  return NextResponse.json({ ok: true, sent, closedTask: !!closedTask });
}
