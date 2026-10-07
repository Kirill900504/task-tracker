import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordEvent } from "@/lib/itemHistory";
import { actorName } from "@/lib/actorName";
import { fmtDate } from "@/lib/taskDisplay";
import { mirrorClosed } from "@/lib/botMirror";
import { sendToPerson } from "@/lib/reach";
import { meetingButtons, type ColleagueRow } from "@/lib/colleagues";
import { isSelfAssignee } from "@/lib/trackerRows";

// Встречу перенесли — строка об этом в обсуждении обеих встреч.
//
// Слова Кирилла 07.10.2026: «любые комментарии при переносе события… должны
// прикрепляться к чату задачи или встречи текущей». Перенос заводит НОВУЮ
// встречу и закрывает прежнюю (MeetingsPanel.closeAsMoved), и до сих пор ни
// одна из двух лент об этом не говорила: у прежней обсуждение обрывалось на
// «будет / не сможет», у новой начиналось с пустоты — и вопрос «а почему
// перенесли» задавали заново.
//
// Сами встречи пишет движок синхронизации (их колонки — его), поэтому здесь
// только хроника: системную строку браузер писать не вправе (миграция 0026).
// Заодно приглашения на прежнее время в мессенджерах теряют кнопки — «Буду»
// под перенесённой встречей отвечал бы о времени, которого больше нет.

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { fromId?: string; toId?: string; note?: string } | null;
  if (!body?.fromId || !body?.toId) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });
  const note = (body.note || "").trim().slice(0, 1000);

  const admin = createAdminClient();
  type Row = { id: string; title: string; date: string; time: string | null; user_id: string; created_by: string | null };
  const read = async (id: string) =>
    (await admin.from("meetings").select("id, title, date, time, user_id, created_by").eq("id", id).maybeSingle()).data as Row | null;

  // Новая встреча едет в облако своим ходом (движок синхронизации), и
  // вкладка зовёт маршрут сразу: несколько секунд подождать дешевле, чем
  // строка, потерянная из-за гонки.
  const from = await read(body.fromId);
  let to = await read(body.toId);
  for (let i = 0; i < 10 && !to; i++) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    to = await read(body.toId);
  }
  if (!from || !to) return NextResponse.json({ error: "Встреча не найдена" }, { status: 404 });
  // Переносит тот, кто назначил, — то же правило, что у отмены.
  if ((from.created_by || from.user_id) !== user.id || from.user_id !== to.user_id) {
    return NextResponse.json({ error: "Это не ваша встреча" }, { status: 403 });
  }

  const who = await actorName(admin, from.user_id, user.id);
  const wasAt = fmtDate(from.date) + (from.time ? ", " + from.time : "");
  const nowAt = fmtDate(to.date) + (to.time ? ", " + to.time : "");
  const why = note && note !== "Перенесено на следующий этап" ? `: ${note}` : "";
  await Promise.all([
    recordEvent(admin, { actorUserId: user.id, userId: from.user_id, kind: "meeting", itemId: from.id, text: `📅 ${who} перенёс встречу на ${nowAt}${why}` }),
    recordEvent(admin, { actorUserId: user.id, userId: to.user_id, kind: "meeting", itemId: to.id, text: `📅 Перенесена с ${wasAt}${why}` }),
  ]);
  after(() => mirrorClosed(admin, "meeting", from.id, `📅 ${from.title}\n${wasAt}\n\n➡ Встреча перенесена на ${nowAt} — приглашение на новое время в сообщении ниже.`));
  const sent = await announceMove(admin, user.id, to, `📅 ${who} перенёс встречу\n\n${to.title}\n\nБыло: ${wasAt}\nСтало: ${nowAt}${why ? "\n\n" + why.slice(2) : ""}`);
  return NextResponse.json({ ok: true, sent });
}

// Каждому, кого ждут на новом времени, — отдельное сообщение о ПЕРЕНОСЕ, с
// кнопками ответа уже по новой встрече.
//
// Слова Кирилла 07.10.2026: «если постановщик встречи сам переносит
// назначенную собой встречу, всем участникам обязательно должно прилетать
// уведомление, чтобы они оперативно видели и реагировали (в том числе в
// мессенджерах)». До этого перенос доходил до людей как обычное
// приглашение «📅 Встреча от …» — то есть читался как ВТОРАЯ встреча, а
// прежнее приглашение молча переписывалось, без звука. Теперь вкладка
// приглашение при переносе не шлёт (MeetingsPanel.inviteNewcomers), и это
// сообщение — единственное: в нём и было, и стало, и «Буду / Не смогу».
//
// Уходит после окна «Отменить» (вкладка зовёт маршрут через 6,5 с), так что
// перенос, отменённый через секунду, людям не достаётся вовсе. Тихих часов
// нет — как у отмены: это изменение уже назначенного, а не новость.
async function announceMove(
  admin: ReturnType<typeof createAdminClient>,
  actorId: string,
  meeting: { id: string; user_id: string },
  text: string,
): Promise<number> {
  // Состав — из обоих мест сразу: строки участия вкладка заводит в ту же
  // секунду, что и встречу, и к этой минуте они могут ещё ехать; имена в
  // самой строке встречи приезжают вместе с ней.
  const [{ data: row }, { data: parts }, { data: member }] = await Promise.all([
    admin.from("meetings").select("participants").eq("id", meeting.id).maybeSingle(),
    admin.from("meeting_participants").select("assignee_id").eq("meeting_id", meeting.id),
    admin.from("workspace_members").select("assignee_id").eq("member_id", actorId).eq("status", "active").maybeSingle(),
  ]);
  const names = (((row as { participants?: string[] | null } | null)?.participants) || []).filter(Boolean);
  const ids = ((parts || []) as { assignee_id: string }[]).map((p) => p.assignee_id);
  if (!names.length && !ids.length) return 0;
  const { data: people } = await admin
    .from("assignees")
    .select("id, name, telegram_chat_id, max_user_id")
    .eq("user_id", meeting.user_id)
    .or([ids.length ? `id.in.(${ids.join(",")})` : "", names.length ? `name.in.(${names.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",")})` : ""].filter(Boolean).join(","));
  // Себе не пишут — и «я» здесь тот, кто переносит, а не владелец
  // пространства (правило из CLAUDE.md про lib/reach): у руководителя это
  // его строка членства, у владельца — строка «(я)».
  const myAssignee = (member as { assignee_id: string | null } | null)?.assignee_id || "";
  const audience = ((people || []) as ColleagueRow[]).filter(
    (p) => p.id !== myAssignee && !(actorId === meeting.user_id && isSelfAssignee(p.name || "")),
  );
  const delivered = await Promise.all(
    audience.map((person) => sendToPerson(admin, meeting.user_id, person, text, meetingButtons(meeting.id), { kind: "meeting", itemId: meeting.id })),
  );
  return delivered.filter(Boolean).length;
}
