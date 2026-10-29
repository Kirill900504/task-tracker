import { NextResponse, after } from "next/server";
import { mirrorAnswer } from "@/lib/botMirror";
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
import { takenIdeaAuthor, type IdeaShareKind } from "@/lib/ideaRecipients";
import { claimTakenIdea } from "@/lib/ideaClaim";
import type { Notice } from "@/lib/noticeQueue";
import { taskRef as taskLabel } from "@/lib/taskRef";
import { lockedTaskText, lockedVoteText, openTaskChoices, voteVerdict } from "@/lib/answerRules";

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

  // «Видел»: человек открыл задачу или встречу (миграция 0042, отзыв
  // Витовского «чтобы было понятно, что исполнитель заходил в задачу, но
  // не принял»). Только своя строка — по assignee_id из членства, а не из
  // запроса. Ни хроники, ни сообщений: это отметка, а не событие, и
  // постановщик видит её в составе задачи, когда сам туда заглянет.
  if (body.action === "seen") {
    if (!body.participantId) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });
    const table = body.kind === "meeting" ? "meeting_participants" : "task_participants";
    await admin.from(table).update({ seen_at: now }).eq("id", body.participantId).eq("assignee_id", m.assignee_id);
    return NextResponse.json({ ok: true });
  }

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
      .select("id, idea_id, assignee_id, converted_task_id, kind, ideas(text, created_by)");
    const { data: rec } = body.recipientId
      ? await query.eq("id", body.recipientId).maybeSingle()
      : await query.eq("idea_id", body.ideaId as string).eq("assignee_id", m.assignee_id).maybeSingle();
    type IdeaRef = { text: string; created_by: string | null };
    const recipient = rec as {
      id: string;
      idea_id: string;
      assignee_id: string;
      converted_task_id: string | null;
      kind: IdeaShareKind | null;
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
    // Постановщик отправленной мысли — её автор: прислал он, значит он и
    // поручил (см. ту же ветку в colleagueReplies). Поделённую взявший
    // берёт сам — задача личная (lib/ideaRecipients.takenIdeaAuthor).
    const createdBy = takenIdeaAuthor(recipient.kind, { userId: user.id, spaceId: m.owner_id }, idea?.created_by || null);
    const { error: taskError } = await admin
      .from("tasks")
      .insert(newTaskRow({ id: taskId, userId: m.owner_id, title, assignee: rowName || myName, createdBy }));
    if (taskError) return NextResponse.json({ error: taskError.message }, { status: 500 });
    // Мысль занимает первое нажатие — второе получает ту же задачу, а не
    // вторую (lib/ideaClaim).
    const claim = await claimTakenIdea(admin, { id: recipient.id }, taskId, now);
    if (!claim.won) return NextResponse.json({ ok: true, taskId: claim.taskId });

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
    await recordEvent(admin, { actorUserId: user.id, userId: m.owner_id, kind: "task", itemId: taskId, text: `➕ ${myName} взял мысль в работу` });
    // Мысль тоже кто-то отправил — ему и знать, что её взяли.
    await notifyAuthor(admin, m.owner_id, idea?.created_by || null, `➕ ${myName} взял мысль в работу: «${title}»`);
    // Сообщение с этой мыслью в мессенджере теряет кнопки — ответ дан.
    const assigneeId = m.assignee_id;
    after(() => mirrorAnswer(admin, { kind: "idea", itemId: recipient.idea_id, assigneeId, text: `💡 ${text}\n\n➕ Взято в работу — теперь это ваша задача` }));
    return NextResponse.json({ ok: true, taskId });
  }

  // «Принял»: присланную мысль прочитали, задачей она не станет. Это ответ,
  // а не «видел» — после него мысль уходит из блока «Прислали вам», а автор
  // видит отметку в списке получателей. Ни хроники, ни сообщения: мысль не
  // работа, и строка «принял к сведению» в чужом мессенджере — тот самый
  // лишний сигнал, по которому ничего не делают.
  //
  // «keep_idea» — то же самое для базы (копию в свои мысли кладёт браузер,
  // через движок синхронизации), и отличается только словами, которыми
  // переписывается сообщение в мессенджере.
  if (body.action === "ack_idea" || body.action === "keep_idea") {
    if (!body.recipientId && !body.ideaId) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });
    const query = admin.from("idea_recipients").update({ seen_at: now }).eq("assignee_id", m.assignee_id);
    const { data: done, error } = await (body.recipientId
      ? query.eq("id", body.recipientId)
      : query.eq("idea_id", body.ideaId as string)
    ).select("idea_id, ideas(text)");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!done?.length) return NextResponse.json({ error: "Эта мысль не ваша" }, { status: 403 });
    // Ответ дан в трекере — значит, кнопки «Прочитать / Сохранить / В
    // работу» под этой мыслью в мессенджере больше не правда (0052).
    type Done = { idea_id: string; ideas: { text: string } | { text: string }[] | null };
    const row = done[0] as unknown as Done;
    const ideaText = (Array.isArray(row.ideas) ? row.ideas[0]?.text : row.ideas?.text) || "";
    const verdict = body.action === "keep_idea" ? "📌 Сохранено в ваши мысли" : "👁 Прочитано";
    const assigneeId = m.assignee_id;
    after(() => mirrorAnswer(admin, { kind: "idea", itemId: row.idea_id, assigneeId, text: `💡 ${ideaText}\n\n${verdict}` }));
    return NextResponse.json({ ok: true });
  }

  // Присланная мысль стала задачей или встречей — в обычной форме трекера
  // («В работу» и «Встреча» в блоке «Прислали вам»). Саму задачу или
  // встречу завёл браузер через движок синхронизации, сюда приходит только
  // её id, когда форма сохранена. Ответ отмечается сразу (мысль уходит из
  // блока на всех устройствах), а связь с задачей — когда задача доедет до
  // базы: на converted_task_id стоит внешний ключ, и запись раньше времени
  // молча упала бы.
  if (body.action === "idea_task" || body.action === "idea_meeting") {
    const itemId = body.action === "idea_task" ? body.taskId : body.meetingId;
    if (!body.recipientId || !itemId) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });
    const { data: rec } = await admin
      .from("idea_recipients")
      .select("id, idea_id, assignee_id, ideas(text, created_by)")
      .eq("id", body.recipientId)
      .maybeSingle();
    type IdeaRef = { text: string; created_by: string | null };
    const recipient = rec as { id: string; idea_id: string; assignee_id: string; ideas: IdeaRef | IdeaRef[] | null } | null;
    if (!recipient || recipient.assignee_id !== m.assignee_id) return NextResponse.json({ error: "Эта мысль не ваша" }, { status: 403 });
    await admin.from("idea_recipients").update({ seen_at: now }).eq("id", recipient.id);

    const idea = Array.isArray(recipient.ideas) ? recipient.ideas[0] : recipient.ideas;
    const text = idea?.text || "";
    const ownerId = m.owner_id;
    const assigneeId = m.assignee_id;
    const isTask = body.action === "idea_task";
    after(async () => {
      const table = isTask ? "tasks" : "meetings";
      const columns = isTask ? "id, title, assignee, deadline" : "id, title, date, time";
      let row: Record<string, string | null> | null = null;
      for (let i = 0; i < 16 && !row; i++) {
        const { data } = await admin.from(table).select(columns).eq("id", itemId).eq("user_id", ownerId).maybeSingle();
        row = (data as Record<string, string | null> | null) || null;
        if (!row) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!row) return;
      let verdict: string;
      if (isTask) {
        await admin.from("idea_recipients").update({ converted_task_id: itemId }).eq("id", recipient.id);
        const who = withoutSelfMark(row.assignee || "");
        verdict = `✅ Поручено: ${who}${row.deadline ? ", срок " + fmtDate(row.deadline) : ", без срока"}`;
        await notifyAuthor(admin, ownerId, idea?.created_by || null, `➕ ${myName} поручил вашу мысль: ${who} — «${row.title}»`, {
          kind: "idea_taken",
          item: row.title || text,
          who: myName,
        });
      } else {
        verdict = `✅ Встреча: ${fmtDate(row.date || "")}${row.time ? ", " + row.time : ""}`;
      }
      await mirrorAnswer(admin, { kind: "idea", itemId: recipient.idea_id, assigneeId, text: `💡 ${text}\n\n${verdict}` });
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "vote") {
    const { data: row } = await admin
      .from("meeting_participants")
      .select("id, assignee_id, meeting_id, response, late, round, meetings(title, date, time, vote_round, created_by)")
      .eq("id", body.participantId)
      .maybeSingle();
    type MeetingRef = { title: string; date: string; time: string | null; vote_round: number | null; created_by: string | null };
    const vote = row as {
      assignee_id: string;
      meeting_id: string;
      response: "none" | "yes" | "no";
      late: boolean | null;
      round: number | null;
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

    const nextRound = Number(meeting?.vote_round ?? 1) || 1;
    // Ответ даётся один раз (lib/answerRules): после «буду» можно только
    // предупредить об опоздании, после «опоздаю» и «не смогу» — ничего, до
    // переноса встречи. Повтор того же ответа — не событие (до 24.09.2026
    // каждое лишнее нажатие писало в хронику ещё одно «будет»).
    const verdict = voteVerdict(vote, body.response as "yes" | "late" | "no", nextRound);
    if (verdict === "same") return NextResponse.json({ ok: true, scheduled: false });
    if (verdict === "locked") return NextResponse.json({ error: lockedVoteText(vote) }, { status: 409 });
    // Ответ из трекера — и в мессенджерах приглашение перестаёт
    // предлагать «Буду / Не смогу» (lib/botMirror). После ответа браузеру.
    after(() => mirrorAnswer(admin, { kind: "meeting", itemId: vote.meeting_id, assigneeId: vote.assignee_id }));

    await admin
      .from("meeting_participants")
      .update({
        response: coming ? "yes" : "no",
        reason: coming ? null : reason,
        responded_at: now,
        round: nextRound,
        late,
      })
      .eq("id", body.participantId);

    const when = meeting ? fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "") : "";
    await recordEvent(admin, {
      actorUserId: user.id,
      userId: m.owner_id,
      kind: "meeting",
      itemId: vote.meeting_id,
      text: late ? `🕐 ${myName} будет, но опоздает` : coming ? `✅ ${myName} будет` : `❌ ${myName} не сможет: ${reason}`,
    });
    // Организатору, а не владельцу: планёрку собирает тот, кому и важно,
    // кто на неё придёт. Сводкой, как и тот же ответ из мессенджера
    // (colleagueReplies): до 14.10.2026 ответ из трекера уходил отдельным
    // сообщением, а из бота — строкой в сводку, и «буду» одного и того же
    // человека приходило организатору по-разному в зависимости от того,
    // какую кнопку он нажал. И не самому организатору: о своём ответе ему
    // сообщать незачем — то же правило, что у задач ниже.
    if ((meeting?.created_by || m.owner_id) !== user.id) await notifyAuthor(
      admin,
      m.owner_id,
      meeting?.created_by || null,
      late
        ? `🕐 ${myName} будет на встрече «${meeting?.title || ""}» (${when}), но опоздает`
        : coming
          ? `✅ ${myName} будет на встрече «${meeting?.title || ""}» (${when})`
          : `❌ ${myName} не сможет быть на «${meeting?.title || ""}» (${when}): ${reason}`,
      {
        kind: late ? "vote_late" : coming ? "vote_yes" : "vote_no",
        item: meeting?.title || "",
        itemId: vote.meeting_id,
        who: myName,
        what: coming ? when : reason,
      },
    );
    // Предложение, на которое согласились все, становится встречей само —
    // иначе «все сказали „буду“» ничем не отличается от «никто не ответил».
    const agreed = await confirmIfEveryoneAgreed(admin, vote.meeting_id);
    return NextResponse.json({ ok: true, scheduled: agreed.confirmed });
  }

  if (!body.participantId) return NextResponse.json({ error: "Неполный запрос" }, { status: 400 });
  const { data: row } = await admin
    .from("task_participants")
    .select("id, assignee_id, task_id, role, accepted_at, done_at, declined_at, reschedule_requested_at, reschedule_reason, tasks(title, number, created_by, approval_state, each_own)")
    .eq("id", body.participantId)
    .maybeSingle();
  type TaskRef = { title: string; number: number | null; created_by: string | null; approval_state: string | null; each_own?: boolean | null };
  const part = row as {
    id: string;
    assignee_id: string;
    task_id: string;
    role: string | null;
    accepted_at: string | null;
    done_at: string | null;
    declined_at: string | null;
    reschedule_requested_at: string | null;
    reschedule_reason: string | null;
    tasks: TaskRef | TaskRef[] | null;
  } | null;
  if (!part || part.assignee_id !== m.assignee_id) return NextResponse.json({ error: "Это не ваша задача" }, { status: 403 });
  // Наблюдатель смотрит и пишет в обсуждение — и только. Бот это знал
  // (colleagueReplies), а маршрут нет: аудит 20.10.2026 отчитался
  // «Сделал» от имени наблюдателя, и задача на приёмке собирала отчёт
  // человека, который её не делал.
  if (part.role === "watcher") {
    return NextResponse.json({ error: "Вы наблюдатель — отвечают исполнители. Написать можно в обсуждении." }, { status: 403 });
  }

  // Ответ даётся один раз (lib/answerRules): «Сделал» и «Не могу»
  // окончательны, пока постановщик не вернёт задачу на доработку; «Принял»
  // и просьба о переносе не повторяются. Окно эти кнопки уже прячет, но
  // старая кнопка под сообщением бота и вторая вкладка — нет.
  const taskRef = Array.isArray(part.tasks) ? part.tasks[0] : part.tasks;
  const myPart = {
    acceptedAt: part.accepted_at,
    doneAt: part.done_at,
    declinedAt: part.declined_at,
    reschedulePending: !!part.reschedule_requested_at && !!part.reschedule_reason,
    // На приёмке ответы заморожены у всех исполнителей — в том числе у
    // того, кто ещё ничего не нажимал (задачу целиком сдал другой).
    onReview: taskRef?.approval_state === "awaiting_review",
  };
  const open = openTaskChoices(myPart);
  const allowed =
    body.action === "accept" ? open.accept : body.action === "done" ? open.done : body.action === "decline" ? open.decline : body.action === "reschedule" ? open.move : true;
  // Второе «Принял» — не ошибка, а эхо первого: отвечаем «да» и молчим.
  if (!allowed && body.action === "accept" && myPart.acceptedAt && !myPart.doneAt && !myPart.declinedAt) return NextResponse.json({ ok: true });
  if (!allowed) return NextResponse.json({ error: lockedTaskText(myPart) }, { status: 409 });
  const title = taskRef?.title || "";
  // «#12 «Смета»» — номер для ориентира (lib/taskRef), и он же в сводке.
  const named = taskLabel({ title, number: taskRef?.number });
  const ref = { item: title, itemId: part.task_id, num: taskRef?.number ?? null, who: myName };
  // Ответ адресован тому, кто поручил. Пока поручает только владелец, это
  // он и есть; как только поручит руководитель — узнает он, а не Кирилл.
  //
  // Кроме случая, когда постановщик и есть отвечающий: своя задача, свой
  // отчёт. Игорь Витковский получил утром сводку «Отчитались о своей
  // части: Игорь Витковский — „Тест на 2 исполнителях“» — о собственном
  // нажатии, сделанном накануне (отзыв 25.09.2026).
  const authorId = taskRef?.created_by || m.owner_id;
  //
  // После ответа браузеру (after): ответ уже записан, а сообщение
  // постановщику — это поиск его чатов, очередь сводки, иногда полёт до
  // Telegram и MAX. Человек, нажавший «Сделал», ждал всё это целиком
  // (замер 20.10.2026: «Принял» 0,5–0,7 с, «Сделал» 0,7–0,8 с на тёплой
  // функции). Так же уже устроены приёмка и рассылки итогов.
  const ownerId = m.owner_id;
  const tell = (text: string, notice?: Notice) => {
    if (authorId !== user.id) after(() => notifyAuthor(admin, ownerId, taskRef?.created_by || null, text, notice).then(() => undefined));
  };
  // Ответ, данный в трекере, переписывает и сообщения о задаче в
  // мессенджерах (lib/botMirror): иначе там так и висят «Принял / Сделал»
  // после того, как человек уже отчитался. После ответа браузеру — ждать
  // полётов до Telegram и MAX ему незачем. Если ветка ниже откажет,
  // правка просто перерисует то же состояние.
  after(() => mirrorAnswer(admin, { kind: "task", itemId: part.task_id, assigneeId: part.assignee_id }));

  if (body.action === "accept") {
    // Три записи друг от друга не зависят — одним заходом, а не тремя.
    await Promise.all([
      admin.from("task_participants").update({ accepted_at: now }).eq("id", part.id),
      admin.from("tasks").update({ accepted_at: now }).eq("id", part.task_id),
      recordEvent(admin, { actorUserId: user.id, userId: m.owner_id, kind: "task", itemId: part.task_id, text: `✅ ${myName} принял в работу` }),
    ]);
    tell(`✅ ${myName} принял в работу: ${named}`, { kind: "accepted", ...ref });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "done") {
    const comment = (body.comment || "").trim();
    if (!canReportDone(comment)) return NextResponse.json({ error: "Нужен комментарий" }, { status: 400 });
    // Документы к отчёту едут вместе с ним (миграция 0039): в корзине они
    // уже лежат, здесь записываются описания. Пустой массив — не то же
    // самое, что «не трогать»: отчёт, отправленный второй раз без файлов,
    // не должен таскать за собой вложения первого.
    const files = body.attachments || [];
    // «Сдал целиком»: задача уходит на приёмку, не дожидаясь остальных
    // исполнителей (closeIfEveryoneReported). Соисполнитель сюда не доходит
    // ни из одной двери — «Сделал» ему не даётся (TaskAnswer, taskButtons).
    // «Каждый сдаёт сам» (миграция 0067): отчёт за всех у такой задачи
    // невозможен по смыслу — старая кнопка или вторая вкладка сдают только
    // свою часть.
    const whole = !!body.whole && taskRef?.each_own !== true;
    await admin
      .from("task_participants")
      .update({
        done_at: now,
        done_comment: comment,
        done_files: files,
        declined_at: null,
        decline_reason: null,
        // Просьба о переносе, если она была, теряет смысл: работа готова,
        // двигать срок больше не для чего. Без этого постановщик видел бы
        // одновременно старую просьбу «перенесите» и «отчитались все, готовы
        // принять» — два окна на одно решение, которое уже не то (23.09.2026).
        reschedule_requested_at: null,
        reschedule_to: null,
        reschedule_reason: null,
      })
      .eq("id", part.id);
    // Та же проверка, что и у кнопки в мессенджере — буквально та же
    // функция, потому что «отчитались все» не должно значить разное в
    // зависимости от того, откуда пришёл последний отчёт.
    // Хроника и проверка «отчитались все» независимы — параллельно.
    const [, everyone] = await Promise.all([
      recordEvent(admin, {
        actorUserId: user.id,
        userId: m.owner_id,
        kind: "task",
        itemId: part.task_id,
        // Файл в хронике называется числом, а не именем: имён бывает три, и
        // строка события — это отметка на полях, а не список вложений.
        text: `🏁 ${myName} ${whole ? "сдал задачу целиком" : "отчитался"}: ${comment}` + (files.length ? ` (📎 ${files.length})` : ""),
      }),
      closeIfEveryoneReported(admin, part.task_id, whole),
    ]);
    // Про файлы в мессенджере говорится словами, но не ссылкой: ссылка на
    // файл из закрытой корзины живёт час, а сообщение — навсегда, и через
    // сутки она читалась бы как сломанная.
    const attached = files.length ? `\n📎 Приложено файлов: ${files.length} — смотреть в задаче.` : "";
    tell(
      everyone
        ? `🏁 ${myName} по задаче ${named}: ${comment}${attached}\n\n${whole ? "Сдал задачу целиком" : "Отчитались все"} — задача ждёт вашей приёмки.`
        : `🏁 ${myName} по задаче ${named}: ${comment}${attached}`,
      { kind: everyone ? "reported_all" : "reported", ...ref, what: comment },
    );
    return NextResponse.json({ ok: true, awaitingReview: everyone });
  }

  if (body.action === "decline") {
    const reason = (body.comment || "").trim();
    if (!canDecline(reason)) return NextResponse.json({ error: "Нужна причина" }, { status: 400 });
    await admin
      .from("task_participants")
      // Документы прежнего отчёта уходят вместе с ним: «не могу» после
      // «сделал» означает, что того результата больше нет, а файлы,
      // оставшиеся рядом с отказом, читались бы как его подтверждение.
      // Просьба о переносе — тем же движением: «не могу» это и ответ на
      // неё, а не повод держать оба вопроса перед постановщиком разом.
      .update({
        declined_at: now,
        decline_reason: reason,
        done_at: null,
        done_comment: null,
        done_files: [],
        reschedule_requested_at: null,
        reschedule_to: null,
        reschedule_reason: null,
      })
      .eq("id", part.id);
    // Отказ — тоже ответ, и после него задача ждёт решения постановщика, а
    // не исполнителя. Раньше здесь не вызывалось ничего, и задача с
    // единственным отказавшимся исполнителем оставалась «в работе»
    // навсегда: ждать было некого, а на приёмке она не появлялась. Слова
    // Кирилла 21.09.2026: «после отказа задача не переносится „на
    // приёмку“».
    const [, everyone] = await Promise.all([
      recordEvent(admin, { actorUserId: user.id, userId: m.owner_id, kind: "task", itemId: part.task_id, text: `⛔ ${myName} не может: ${reason}` }),
      closeIfEveryoneReported(admin, part.task_id),
    ]);
    tell(
      everyone
        ? `⛔ ${myName} не может ${named}: ${reason}\n\nОтветили все — задача ждёт вашего решения.`
        : `⛔ ${myName} не может ${named}: ${reason}`,
      { kind: "declined", ...ref, what: reason },
    );
    return NextResponse.json({ ok: true, awaitingReview: everyone });
  }

  if (body.action === "reschedule") {
    const reason = (body.comment || "").trim();
    if (!reason) return NextResponse.json({ error: "Нужна причина" }, { status: 400 });
    const to = body.date ? ` на ${fmtDate(body.date)}` : "";
    await Promise.all([
      admin
        .from("task_participants")
        .update({ reschedule_requested_at: now, reschedule_to: body.date || null, reschedule_reason: reason })
        .eq("id", part.id),
      recordEvent(admin, { actorUserId: user.id, userId: m.owner_id, kind: "task", itemId: part.task_id, text: `📅 ${myName} просит перенос${to}: ${reason}` }),
    ]);
    tell(`📅 ${myName} просит перенести ${named}${to}: ${reason}`, { kind: "reschedule", ...ref, what: `${to.trim() || "на другой срок"} — ${reason}` });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
