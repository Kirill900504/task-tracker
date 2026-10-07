import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordEvent } from "@/lib/itemHistory";
import { actorName } from "@/lib/actorName";
import { fmtDate } from "@/lib/taskDisplay";
import { mirrorClosed } from "@/lib/botMirror";

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
    recordEvent(admin, { userId: from.user_id, kind: "meeting", itemId: from.id, text: `📅 ${who} перенёс встречу на ${nowAt}${why}` }),
    recordEvent(admin, { userId: to.user_id, kind: "meeting", itemId: to.id, text: `📅 Перенесена с ${wasAt}${why}` }),
  ]);
  after(() => mirrorClosed(admin, "meeting", from.id, `📅 ${from.title}\n${wasAt}\n\n➡ Встреча перенесена на ${nowAt} — приглашение на новое время придёт отдельно.`));
  return NextResponse.json({ ok: true });
}
