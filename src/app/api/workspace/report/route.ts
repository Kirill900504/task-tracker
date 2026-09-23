import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readInput, reportInput } from "@/lib/apiInput";
import { notifyAuthor } from "@/lib/botDelivery";
import { closeIfEveryoneReported } from "@/lib/colleagueReplies";
import { canDecline, canReportDone } from "@/lib/taskProgress";
import { canVoteNo } from "@/lib/meetingVotes";
import { fmtDate } from "@/lib/taskDisplay";
import { uid } from "@/lib/uid";
import { withoutSelfMark } from "@/lib/actorName";
import { confirmIfEveryoneAgreed } from "@/lib/meetingConfirm";
import { newTaskRow } from "@/lib/newTask";
import { recordEvent } from "@/lib/itemHistory";
import { isSelfAssignee } from "@/lib/trackerRows";
import type { Notice } from "@/lib/noticeQueue";

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

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const { data: body, error: badInput } = await readInput(req, reportInput);
  if (badInput) return badInput;

  const admin = createAdminClient();

  // Кто отвечает — берётся из членства, а не из запроса: иначе достаточно
  // было бы прислать чужой id строки, чтобы отчитаться за другого.
  const { data: member } = await admin
    .from("workspace_members")
    .select("owner_id, assignee_id, status, assignees(name)")
    .eq("member_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  type Member = { owner_id: string; assignee_id: string; assignees: { name: string } | { name: string }[] | null };
  let m = member as Member | null;

  // Владельцу тоже ставят задачи — и с тех пор, как руководители работают
  // в паритете, это обычное дело, а не исключение. Строки членства у него
  // нет и не будет (её отсутствие и ЕСТЬ признак владельца), поэтому его
  // собственная строка в списке людей ищется по метке «(я)»: она для того
  // в этом списке и стоит. Без этого «Сделал» по задаче, которую поставил
  // ему Игорь, отвечало «Вы не участник этого трекера».
  if (!m) {
    const { data: mine } = await admin.from("assignees").select("id, name").eq("user_id", user.id);
    const self = (mine || []).find((r) => isSelfAssignee((r.name as string) || ""));
    if (self) m = { owner_id: user.id, assignee_id: self.id as string, assignees: { name: self.name as string } };
  }
  if (!m) return NextResponse.json({ error: "Вы не участник этого трекера" }, { status: 403 });

  // Полное имя строки — в саму задачу: по нему её потом находят бот,
  // сводки и карточки, и «(я)» там часть имени. В текстах, которые
  // читают ЛЮДИ, пометки быть не должно: она написана для одного
  // человека, а читают их все.
  const rowName = (Array.isArray(m.assignees) ? m.assignees[0]?.name : m.assignees?.name) || "";
  const myName = withoutSelfMark(rowName) || "Участник";
  const now = new Date().toISOString();

  // «Взять в работу»: мысль становится задачей на этого же человека.
  //
  // Только через сервер. Завести задачу руководитель может сам, а вот
  // назначить себя исполнителем — нет: писать в task_participants
  // разрешено владельцу пространства, и это правильно (иначе любой мог бы
  // вписать себя в чужую задачу). Из браузера получалась бы задача без
  // единого исполнителя, которую не видно даже тому, кто её взял.
  if (body.action === "take_idea") {
    if (!body.recipientId && !body.ideaId) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });
    // Из бота приходит строка рассылки (её знает кнопка под сообщением), из
    // трекера — сама мысль: строк рассылки на экране нет. Оба пути сходятся
    // в одну строку, и оба её проверяют — она должна быть моя.
    const query = admin
      .from("idea_recipients")
      .select("id, idea_id, assignee_id, converted_task_id, ideas(text, created_by)");
    const { data: rec } = body.recipientId
      ? await query.eq("id", body.recipientId).maybeSingle()
      : await query.eq("idea_id", body.ideaId as string).eq("assignee_id", m.assignee_id).maybeSingle();
    type IdeaRef = { text: string; created_by: string | null };
    const recipient = rec as {
      id: string;
      idea_id: string;
      assignee_id: string;
      converted_task_id: string | null;
      ideas: IdeaRef | IdeaRef[] | null;
    } | null;
    if (!recipient || recipient.assignee_id !== m.assignee_id) {
      return NextResponse.json({ error: "Эта мысль не ваша" }, { status: 403 });
    }
    if (recipient.converted_task_id) return NextResponse.json({ ok: true, taskId: recipient.converted_task_id });

    const idea = Array.isArray(recipient.ideas) ? recipient.ideas[0] : recipient.ideas;
    const text = idea?.text || "";
    const title = text.trim().slice(0, 200) || "Из мысли";
    const taskId = uid();
    // Без срока: срок ставит тот, кто спросит, а не тот, кто взялся.
    const { error: taskError } = await admin
      .from("tasks")
      .insert(newTaskRow({ id: taskId, userId: m.owner_id, title, assignee: rowName || myName, createdBy: user.id }));
    if (taskError) return NextResponse.json({ error: taskError.message }, { status: 500 });

    // upsert, а не insert: имя исполнителя стоит в самой задаче, и строку
    // по нему успевает завести триггер (миграция 0024) — простая вставка
    // упёрлась бы в уникальность и оставила задачу без отметки «принял».
    await admin.from("task_participants").upsert(
      {
        task_id: taskId,
        assignee_id: m.assignee_id,
        role: "executor",
        accepted_at: now,
      },
      { onConflict: "task_id,assignee_id" },
    );
    await admin.from("idea_recipients").update({ converted_task_id: taskId, seen_at: now }).eq("id", recipient.id);
    await recordEvent(admin, { userId: m.owner_id, kind: "task", itemId: taskId, text: `➕ ${myName} взял мысль в работу` });
    // Мысль тоже кто-то отправил — ему и знать, что её взяли.
    await notifyAuthor(admin, m.owner_id, idea?.created_by || null, `➕ ${myName} взял мысль в работу: «${title}»`);
    return NextResponse.json({ ok: true, taskId });
  }

  if (body.action === "vote") {
    const { data: row } = await admin
      .from("meeting_participants")
      .select("id, assignee_id, meeting_id, meetings(title, date, time, vote_round, created_by)")
      .eq("id", body.participantId)
      .maybeSingle();
    type MeetingRef = { title: string; date: string; time: string | null; vote_round: number | null; created_by: string | null };
    const vote = row as {
      assignee_id: string;
      meeting_id: string;
      meetings: MeetingRef | MeetingRef[] | null;
    } | null;
    if (!vote || vote.assignee_id !== m.assignee_id) return NextResponse.json({ error: "Это не ваша встреча" }, { status: 403 });

    const meeting = Array.isArray(vote.meetings) ? vote.meetings[0] : vote.meetings;
    // Опоздавший — это пришедший: кворум он не ломает и встречу из-за него
    // не переносят. Отдельной колонкой, а не третьим значением ответа
    // (миграция 0029).
    const late = body.response === "late";
    const coming = body.response === "yes" || late;
    const reason = (body.comment || "").trim();
    if (!coming && !canVoteNo(reason)) return NextResponse.json({ error: "Нужна причина" }, { status: 400 });

    await admin
      .from("meeting_participants")
      .update({
        response: coming ? "yes" : "no",
        reason: coming ? null : reason,
        responded_at: now,
        round: Number(meeting?.vote_round ?? 1) || 1,
        late,
      })
      .eq("id", body.participantId);

    const when = meeting ? fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "") : "";
    await recordEvent(admin, {
      userId: m.owner_id,
      kind: "meeting",
      itemId: vote.meeting_id,
      text: late ? `🕐 ${myName} будет, но опоздает` : coming ? `✅ ${myName} будет` : `❌ ${myName} не сможет: ${reason}`,
    });
    // Организатору, а не владельцу: планёрку собирает тот, кому и важно,
    // кто на неё придёт.
    await notifyAuthor(
      admin,
      m.owner_id,
      meeting?.created_by || null,
      late
        ? `🕐 ${myName} будет на встрече «${meeting?.title || ""}» (${when}), но опоздает`
        : coming
          ? `✅ ${myName} будет на встрече «${meeting?.title || ""}» (${when})`
          : `❌ ${myName} не сможет быть на «${meeting?.title || ""}» (${when}): ${reason}`,
    );
    // Предложение, на которое согласились все, становится встречей само —
    // иначе «все сказали „буду“» ничем не отличается от «никто не ответил».
    const agreed = await confirmIfEveryoneAgreed(admin, vote.meeting_id);
    return NextResponse.json({ ok: true, scheduled: agreed.confirmed });
  }

  if (!body.participantId) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });
  const { data: row } = await admin
    .from("task_participants")
    .select("id, assignee_id, task_id, tasks(title, created_by)")
    .eq("id", body.participantId)
    .maybeSingle();
  type TaskRef = { title: string; created_by: string | null };
  const part = row as {
    id: string;
    assignee_id: string;
    task_id: string;
    tasks: TaskRef | TaskRef[] | null;
  } | null;
  if (!part || part.assignee_id !== m.assignee_id) return NextResponse.json({ error: "Это не ваша задача" }, { status: 403 });
  const taskRef = Array.isArray(part.tasks) ? part.tasks[0] : part.tasks;
  const title = taskRef?.title || "";
  // Ответ адресован тому, кто поручил. Пока поручает только владелец, это
  // он и есть; как только поручит руководитель — узнает он, а не Кирилл.
  const tell = (text: string, notice?: Notice) => notifyAuthor(admin, m.owner_id, taskRef?.created_by || null, text, notice);

  if (body.action === "accept") {
    await admin.from("task_participants").update({ accepted_at: now }).eq("id", part.id);
    await admin.from("tasks").update({ accepted_at: now }).eq("id", part.task_id);
    await recordEvent(admin, { userId: m.owner_id, kind: "task", itemId: part.task_id, text: `✅ ${myName} принял в работу` });
    await tell(`✅ ${myName} принял в работу: «${title}»`, { kind: "accepted", item: title, who: myName });
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
    await recordEvent(admin, { userId: m.owner_id, kind: "task", itemId: part.task_id, text: `🏁 ${myName} отчитался: ${comment}` });
    const everyone = await closeIfEveryoneReported(admin, part.task_id);
    await tell(
      everyone
        ? `🏁 ${myName} по задаче «${title}»: ${comment}\n\nОтчитались все — задача ждёт вашей приёмки.`
        : `🏁 ${myName} по задаче «${title}»: ${comment}`,
      { kind: everyone ? "reported_all" : "reported", item: title, who: myName, what: comment },
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
    await recordEvent(admin, { userId: m.owner_id, kind: "task", itemId: part.task_id, text: `⛔ ${myName} не может: ${reason}` });
    // Отказ — тоже ответ, и после него задача ждёт решения постановщика, а
    // не исполнителя. Раньше здесь не вызывалось ничего, и задача с
    // единственным отказавшимся исполнителем оставалась «в работе»
    // навсегда: ждать было некого, а на приёмке она не появлялась. Слова
    // Кирилла 21.09.2026: «после отказа задача не переносится „на
    // приёмку“».
    const everyone = await closeIfEveryoneReported(admin, part.task_id);
    await tell(
      everyone
        ? `⛔ ${myName} не может «${title}»: ${reason}\n\nОтветили все — задача ждёт вашего решения.`
        : `⛔ ${myName} не может «${title}»: ${reason}`,
      { kind: "declined", item: title, who: myName, what: reason },
    );
    return NextResponse.json({ ok: true, awaitingReview: everyone });
  }

  if (body.action === "reschedule") {
    const reason = (body.comment || "").trim();
    if (!reason) return NextResponse.json({ error: "Нужна причина" }, { status: 400 });
    await admin
      .from("task_participants")
      .update({ reschedule_requested_at: now, reschedule_to: body.date || null, reschedule_reason: reason })
      .eq("id", part.id);
    const to = body.date ? ` на ${fmtDate(body.date)}` : "";
    await recordEvent(admin, { userId: m.owner_id, kind: "task", itemId: part.task_id, text: `📅 ${myName} просит перенос${to}: ${reason}` });
    await tell(`📅 ${myName} просит перенести «${title}»${to}: ${reason}`, { kind: "reschedule", item: title, who: myName, what: `${to.trim() || "на другой срок"} — ${reason}` });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
