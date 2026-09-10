import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyOwner } from "@/lib/botDelivery";
import { closeIfEveryoneReported } from "@/lib/colleagueReplies";
import { canDecline, canReportDone } from "@/lib/taskProgress";
import { canVoteNo } from "@/lib/meetingVotes";
import { fmtDate } from "@/lib/taskDisplay";
import { uid } from "@/lib/uid";

// Ответ руководителя: один путь для трекера и для мессенджера.
//
// Отвечать можно из двух мест, и до сих пор эти два места делали разное.
// Кнопка в Telegram отмечала отчёт, проверяла, отчитались ли все, и писала
// владельцу; та же кнопка на экране руководителя просто меняла строку в
// базе — задача не уходила на приёмку, и владелец не узнавал ничего. Одно
// и то же действие, два разных исхода, и разница видна только тому, кто
// читает код.
//
// Поэтому все ответы идут сюда. Правила — обязательный комментарий,
// обязательная причина, переход на приёмку, письмо владельцу — живут в
// одном месте, а не в двух, и не могут разойтись.

type Body = {
  action: "accept" | "done" | "decline" | "reschedule" | "vote" | "take_idea";
  participantId?: string;
  recipientId?: string;
  comment?: string;
  date?: string;
  response?: "yes" | "no";
  round?: number;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.action) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });

  const admin = createAdminClient();

  // Кто отвечает — берётся из членства, а не из запроса: иначе достаточно
  // было бы прислать чужой id строки, чтобы отчитаться за другого.
  const { data: member } = await admin
    .from("workspace_members")
    .select("owner_id, assignee_id, status, assignees(name)")
    .eq("member_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Вы не участник этого трекера" }, { status: 403 });

  const m = member as { owner_id: string; assignee_id: string; assignees: { name: string } | { name: string }[] | null };
  const myName = (Array.isArray(m.assignees) ? m.assignees[0]?.name : m.assignees?.name) || "Коллега";
  const now = new Date().toISOString();

  // «Взять в работу»: мысль становится задачей на этого же человека.
  //
  // Только через сервер. Завести задачу руководитель может сам, а вот
  // назначить себя исполнителем — нет: писать в task_participants
  // разрешено владельцу пространства, и это правильно (иначе любой мог бы
  // вписать себя в чужую задачу). Из браузера получалась бы задача без
  // единого исполнителя, которую не видно даже тому, кто её взял.
  if (body.action === "take_idea") {
    if (!body.recipientId) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });
    const { data: rec } = await admin
      .from("idea_recipients")
      .select("id, idea_id, assignee_id, converted_task_id, ideas(text)")
      .eq("id", body.recipientId)
      .maybeSingle();
    const recipient = rec as {
      id: string;
      idea_id: string;
      assignee_id: string;
      converted_task_id: string | null;
      ideas: { text: string } | { text: string }[] | null;
    } | null;
    if (!recipient || recipient.assignee_id !== m.assignee_id) {
      return NextResponse.json({ error: "Эта мысль не ваша" }, { status: 403 });
    }
    if (recipient.converted_task_id) return NextResponse.json({ ok: true, taskId: recipient.converted_task_id });

    const text = (Array.isArray(recipient.ideas) ? recipient.ideas[0]?.text : recipient.ideas?.text) || "";
    const title = text.trim().slice(0, 200) || "Из мысли";
    const taskId = uid();
    // Без срока: срок ставит тот, кто спросит, а не тот, кто взялся.
    const { error: taskError } = await admin
      .from("tasks")
      .insert({ id: taskId, user_id: m.owner_id, title, assignee: myName, created_by: user.id });
    if (taskError) return NextResponse.json({ error: taskError.message }, { status: 500 });

    await admin.from("task_participants").insert({
      task_id: taskId,
      assignee_id: m.assignee_id,
      role: "executor",
      accepted_at: now,
    });
    await admin.from("idea_recipients").update({ converted_task_id: taskId, seen_at: now }).eq("id", recipient.id);
    await notifyOwner(admin, m.owner_id, `➕ ${myName} взял мысль в работу: «${title}»`);
    return NextResponse.json({ ok: true, taskId });
  }

  if (body.action === "vote") {
    const { data: row } = await admin
      .from("meeting_participants")
      .select("id, assignee_id, meeting_id, meetings(title, date, time, vote_round)")
      .eq("id", body.participantId)
      .maybeSingle();
    const vote = row as {
      assignee_id: string;
      meeting_id: string;
      meetings: { title: string; date: string; time: string | null; vote_round: number | null } | { title: string; date: string; time: string | null; vote_round: number | null }[] | null;
    } | null;
    if (!vote || vote.assignee_id !== m.assignee_id) return NextResponse.json({ error: "Это не ваша встреча" }, { status: 403 });

    const meeting = Array.isArray(vote.meetings) ? vote.meetings[0] : vote.meetings;
    const coming = body.response === "yes";
    const reason = (body.comment || "").trim();
    if (!coming && !canVoteNo(reason)) return NextResponse.json({ error: "Нужна причина" }, { status: 400 });

    await admin
      .from("meeting_participants")
      .update({
        response: coming ? "yes" : "no",
        reason: coming ? null : reason,
        responded_at: now,
        round: Number(meeting?.vote_round ?? 1) || 1,
      })
      .eq("id", body.participantId);

    const when = meeting ? fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "") : "";
    await notifyOwner(
      admin,
      m.owner_id,
      coming
        ? `✅ ${myName} будет на встрече «${meeting?.title || ""}» (${when})`
        : `❌ ${myName} не сможет быть на «${meeting?.title || ""}» (${when}): ${reason}`,
    );
    return NextResponse.json({ ok: true });
  }

  if (!body.participantId) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });
  const { data: row } = await admin
    .from("task_participants")
    .select("id, assignee_id, task_id, tasks(title)")
    .eq("id", body.participantId)
    .maybeSingle();
  const part = row as {
    id: string;
    assignee_id: string;
    task_id: string;
    tasks: { title: string } | { title: string }[] | null;
  } | null;
  if (!part || part.assignee_id !== m.assignee_id) return NextResponse.json({ error: "Это не ваша задача" }, { status: 403 });
  const title = (Array.isArray(part.tasks) ? part.tasks[0]?.title : part.tasks?.title) || "";

  if (body.action === "accept") {
    await admin.from("task_participants").update({ accepted_at: now }).eq("id", part.id);
    await admin.from("tasks").update({ accepted_at: now }).eq("id", part.task_id);
    await notifyOwner(admin, m.owner_id, `✅ ${myName} принял в работу: «${title}»`);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "done") {
    const comment = (body.comment || "").trim();
    if (!canReportDone(comment)) return NextResponse.json({ error: "Нужен комментарий" }, { status: 400 });
    await admin
      .from("task_participants")
      .update({ done_at: now, done_comment: comment, declined_at: null, decline_reason: null })
      .eq("id", part.id);
    // Та же проверка, что и у кнопки в мессенджере — буквально та же
    // функция, потому что «отчитались все» не должно значить разное в
    // зависимости от того, откуда пришёл последний отчёт.
    const everyone = await closeIfEveryoneReported(admin, part.task_id);
    await notifyOwner(
      admin,
      m.owner_id,
      everyone
        ? `🏁 ${myName} по задаче «${title}»: ${comment}\n\nОтчитались все — задача ждёт вашей приёмки.`
        : `🏁 ${myName} по задаче «${title}»: ${comment}`,
    );
    return NextResponse.json({ ok: true, awaitingReview: everyone });
  }

  if (body.action === "decline") {
    const reason = (body.comment || "").trim();
    if (!canDecline(reason)) return NextResponse.json({ error: "Нужна причина" }, { status: 400 });
    await admin
      .from("task_participants")
      .update({ declined_at: now, decline_reason: reason, done_at: null, done_comment: null })
      .eq("id", part.id);
    await notifyOwner(admin, m.owner_id, `⛔ ${myName} не может «${title}»: ${reason}`);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reschedule") {
    const reason = (body.comment || "").trim();
    if (!reason) return NextResponse.json({ error: "Нужна причина" }, { status: 400 });
    await admin
      .from("task_participants")
      .update({ reschedule_requested_at: now, reschedule_to: body.date || null, reschedule_reason: reason })
      .eq("id", part.id);
    const to = body.date ? ` на ${fmtDate(body.date)}` : "";
    await notifyOwner(admin, m.owner_id, `📅 ${myName} просит перенести «${title}»${to}: ${reason}`);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
