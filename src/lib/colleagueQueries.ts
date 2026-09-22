import type { SupabaseClient } from "@supabase/supabase-js";
import { signInLink } from "@/lib/recoveryLink";
import { trackerUrl } from "@/lib/trackerUrl";
import type { BotButton } from "@/lib/botTransport";
import { encodeCallback, meetingButtons, taskButtons } from "@/lib/colleagues";
import { botMenu, navRow } from "@/lib/botMenu";
import { fmtDate } from "@/lib/taskDisplay";

// О чём коллега может спросить бота.
//
// До сих пор — ни о чём. Команды «сегодня», «просрочено», «встречи»
// работали только у владельца: у коллеги нет строки в таблице аккаунтов, и
// его текст уходил в обсуждение. То есть человек, написавший «какие у меня
// задачи», не получал списка, а молча дописывал свой вопрос в чужую
// карточку — при том что это первый вопрос, который задаёт каждый новый
// человек.
//
// Совпадение точное, а не по вхождению, по той же причине, что и у
// владельца: «сегодня» внутри фразы — это слово, а не команда, и
// проглотить из-за него сообщение хуже, чем не понять команду.
//
// Что видит коллега — только своё: выборки идут по его строке участия, а не
// по пространству. Читать чужие задачи он не вправе и в трекере.

export type ColleagueQuery = "tasks" | "today" | "overdue" | "meetings" | "review" | "menu" | "help" | "enter";

const TRIGGERS: Record<ColleagueQuery, string[]> = {
  tasks: ["/tasks", "мои задачи", "задачи", "мои", "что на мне", "мои дела"],
  today: ["/today", "сегодня", "что сегодня", "что на сегодня", "задачи на сегодня"],
  overdue: ["/overdue", "просрочено", "просроченные", "что просрочено", "просроченные задачи"],
  meetings: ["/meetings", "встречи", "мои встречи", "какие встречи", "ближайшие встречи"],
  review: ["/review", "приёмка", "на приёмке", "приемка", "на приемке"],
  // «Меню» словом — и «старт» вместе с ним: первое, что человек пишет
  // боту, должно показывать разделы, а не текст про них. Справка осталась
  // отдельным словом для того, кто уже видел меню и всё равно не понял.
  menu: ["/menu", "меню", "menu", "разделы", "start", "/start"],
  help: ["/help", "помощь", "команды", "что умеешь"],
  // Вход в трекер без пароля. Слов много нарочно: человек, который не
  // может войти, пишет боту то, что первым придёт в голову, и «не могу
  // войти» должно сработать так же, как «вход».
  enter: ["/enter", "вход", "войти", "трекер", "открыть трекер", "не могу войти", "забыл пароль", "пароль"],
};

export function matchColleagueCommand(text: string): ColleagueQuery | null {
  const norm = text.trim().toLowerCase().replace(/[?!.]+$/, "");
  for (const kind of Object.keys(TRIGGERS) as ColleagueQuery[]) {
    if (TRIGGERS[kind].includes(norm)) return kind;
  }
  return null;
}

export type BotReply = { text: string; buttons?: BotButton[][] };

type TaskRow = {
  id: string;
  role: "executor" | "coexecutor" | "watcher";
  accepted_at: string | null;
  done_at: string | null;
  declined_at: string | null;
  tasks: {
    id: string;
    title: string;
    description: string | null;
    deadline: string | null;
    priority: string | null;
    status: string | null;
    approval_state: string | null;
    approval_comment: string | null;
    deleted_at: string | null;
  } | null;
};

export type MyTask = {
  participantId: string;
  taskId: string;
  title: string;
  description: string;
  deadline: string;
  priority: string;
  role: "executor" | "coexecutor" | "watcher";
  acceptedAt: string | null;
  doneAt: string | null;
  declinedAt: string | null;
  approvalState: string;
  approvalComment: string;
};

// Открытые задачи этого человека. «Открытая» — та, что ещё чего-то от него
// ждёт: закрытые и удалённые не показываются, потому что список, в котором
// лежит всё, читают один раз.
export async function myTasks(admin: SupabaseClient, assigneeId: string): Promise<MyTask[]> {
  const { data } = await admin
    .from("task_participants")
    .select(
      "id, role, accepted_at, done_at, declined_at, " +
        "tasks(id, title, description, deadline, priority, status, approval_state, approval_comment, deleted_at)",
    )
    .eq("assignee_id", assigneeId);

  return ((data as unknown as TaskRow[]) || [])
    .filter((r) => r.tasks && !r.tasks.deleted_at && r.tasks.status !== "done")
    .map((r) => ({
      participantId: r.id,
      taskId: r.tasks!.id,
      title: r.tasks!.title,
      description: r.tasks!.description || "",
      deadline: r.tasks!.deadline || "",
      priority: r.tasks!.priority || "med",
      role: r.role,
      acceptedAt: r.accepted_at,
      doneAt: r.done_at,
      declinedAt: r.declined_at,
      approvalState: r.tasks!.approval_state || "open",
      approvalComment: r.tasks!.approval_comment || "",
    }))
    .sort((a, b) => (a.deadline || "9999-99-99").localeCompare(b.deadline || "9999-99-99"));
}

export type MyMeeting = {
  meetingId: string;
  title: string;
  date: string;
  time: string;
  response: "none" | "yes" | "no";
  round: number;
  meetingRound: number;
};

export async function myMeetings(admin: SupabaseClient, assigneeId: string, today: string): Promise<MyMeeting[]> {
  const { data } = await admin
    .from("meeting_participants")
    .select("meeting_id, response, round, meetings(id, title, date, time, status, vote_round, deleted_at)")
    .eq("assignee_id", assigneeId);

  type Row = {
    meeting_id: string;
    response: "none" | "yes" | "no";
    round: number;
    meetings: { title: string; date: string; time: string | null; status: string; vote_round: number | null; deleted_at: string | null } | null;
  };

  return ((data as unknown as Row[]) || [])
    .filter((r) => r.meetings && !r.meetings.deleted_at && (r.meetings.status === "planned" || r.meetings.status === "proposed") && r.meetings.date >= today)
    .map((r) => ({
      meetingId: r.meeting_id,
      title: r.meetings!.title,
      date: r.meetings!.date,
      time: r.meetings!.time || "",
      response: r.response,
      round: r.round,
      meetingRound: Number(r.meetings!.vote_round ?? 1) || 1,
    }))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

// Строка списка. Заголовок обрезается, потому что в кнопке мессенджера
// длинный текст не переносится, а урезается посередине самим клиентом — и
// тогда не видно ни начала, ни конца.
function taskButton(t: MyTask, mark: string): BotButton {
  const title = t.title.length > 28 ? t.title.slice(0, 27) + "…" : t.title;
  return { text: `${mark} ${title}`, data: encodeCallback("task", "show", t.taskId) };
}

// Значок состояния. Экспортирован вместе со сборкой списка ниже: вся
// логика «что человек увидит» проверяется на голых данных, без базы — тот
// же приём, что у экрана руководителя.
export function markFor(t: MyTask, today: string): string {
  if (t.declinedAt) return "⛔";
  if (t.approvalState === "returned") return "↩";
  if (t.doneAt) return "🏁";
  if (t.deadline && t.deadline < today) return "⚠";
  if (t.deadline === today) return "●";
  if (t.acceptedAt) return "•";
  return "🆕";
}

// Сколько задач помещается в один ответ. Дальше список перестают читать, а
// мессенджер начинает резать сообщение — восемь строк это примерно экран
// телефона вместе с подписями.
const PAGE = 8;

export function listReply(title: string, tasks: MyTask[], today: string, empty: string): BotReply {
  if (!tasks.length) return { text: empty, buttons: navButtons() };
  const shown = tasks.slice(0, PAGE);
  const lines = shown.map((t) => {
    const bits: string[] = [];
    if (t.deadline) bits.push(t.deadline < today ? "просрочено " + fmtDate(t.deadline) : "до " + fmtDate(t.deadline));
    if (t.role === "coexecutor") bits.push("соисполнитель");
    if (t.role === "watcher") bits.push("наблюдатель");
    if (t.approvalState === "returned") bits.push("вернули на доработку");
    if (t.doneAt) bits.push("вы отчитались");
    return `${markFor(t, today)} ${t.title}${bits.length ? "\n   " + bits.join(" · ") : ""}`;
  });
  const more = tasks.length > PAGE ? `\n\nИ ещё ${tasks.length - PAGE} — откройте трекер, там видно всё.` : "";
  return {
    text: `${title} (${tasks.length}):\n\n${lines.join("\n")}${more}\n\nНажмите задачу, чтобы ответить по ней.`,
    buttons: [...shown.map((t) => [taskButton(t, markFor(t, today))]), ...navButtons()],
  };
}

// Нижний ряд под любым списком: откуда угодно — в другой список, не
// пролистывая переписку назад.
//
// Вторая кнопка была «📅 Встречи», и это оставляло человека внутри двух
// разделов: из списка задач он попадал во встречи, из встреч — обратно в
// задачи, а всё остальное существовало, только если угадать слово.
// Теперь здесь дверь в меню, ровно как у постановщика (lib/botMenu).
export function navButtons(): BotButton[][] {
  return navRow("recipient");
}

// «Откройте трекер» — ссылкой, по которой входят без пароля.
//
// Это ответ на то, чем для половины людей трекер заканчивался. В MAX
// кнопки мини-приложения нет (её установка отправляет бота на повторную
// модерацию — решение Кирилла), поэтому ссылка из чата открывается во
// внешнем браузере: ни подписи мессенджера, ни сессии, и человек упирается
// в корпоративный пароль, которого не помнит.
//
// Граница ровно та же, что у мини-приложения: ссылка открывает
// СУЩЕСТВУЮЩИЙ вход, а не заводит новый. У коллеги без входа в трекер его
// и не появится — ему бот и есть трекер, и сказать об этом надо словами, а
// не пустым отказом.
//
// Уходит она в тот чат, откуда пришёл вопрос, — то есть туда же, куда и
// его задачи, и привязывал этот чат владелец. Живёт час и сгорает при
// первом открытии: это условие Supabase, и менять его незачем.
export async function signInReply(admin: SupabaseClient, assigneeId: string): Promise<BotReply> {
  const { data: member } = await admin
    .from("workspace_members")
    .select("member_id, status")
    .eq("assignee_id", assigneeId)
    .maybeSingle();

  if (!member?.member_id || member.status === "revoked") {
    return {
      text:
        "Входа в трекер у вас пока нет — и он не нужен: всё, что от вас ждут, приходит сюда, и отвечать можно прямо отсюда.\n\n" +
        "Если трекер нужен целиком, попросите Кирилла прислать приглашение.",
      buttons: navButtons(),
    };
  }

  const { data: user } = await admin.auth.admin.getUserById(member.member_id as string);
  const email = user?.user?.email;
  if (!email) return { text: "Не получилось собрать ссылку — скажите об этом Кириллу.", buttons: navButtons() };

  const made = await signInLink(admin, email, trackerUrl());
  if ("error" in made) return { text: "Не получилось собрать ссылку — скажите об этом Кириллу.", buttons: navButtons() };

  return {
    text:
      `🔑 Вход в трекер — по этой ссылке, пароль вводить не нужно:\n\n${made.link}\n\n` +
      "Она одноразовая и живёт час. Понадобится снова — напишите «вход».",
    buttons: navButtons(),
  };
}

export async function replyForColleague(
  admin: SupabaseClient,
  colleague: { id: string; name: string },
  kind: ColleagueQuery,
  today: string,
): Promise<BotReply> {
  if (kind === "menu") return botMenu("recipient");
  if (kind === "help") return { text: colleagueCommandsHelp(colleague.name), buttons: navButtons() };
  if (kind === "enter") return signInReply(admin, colleague.id);

  if (kind === "meetings") {
    const meetings = await myMeetings(admin, colleague.id, today);
    if (!meetings.length) return { text: "Встреч впереди нет.", buttons: navButtons() };
    const lines = meetings.slice(0, PAGE).map((m) => {
      // Ответ из прежнего круга не считается: время переносили, и об этом
      // времени человека ещё не спрашивали.
      const answered = m.round === m.meetingRound && m.response !== "none";
      const mark = !answered ? "❓" : m.response === "yes" ? "✅" : "❌";
      return `${mark} ${fmtDate(m.date)}${m.time ? ", " + m.time : ""} — ${m.title}${answered ? "" : "\n   ждём вашего ответа"}`;
    });
    return {
      text: `📅 Ваши встречи (${meetings.length}):\n\n${lines.join("\n")}`,
      buttons: [
        ...meetings.slice(0, PAGE).map((m) => [
          {
            text: `${fmtDate(m.date)} ${m.title.length > 20 ? m.title.slice(0, 19) + "…" : m.title}`,
            data: encodeCallback("meeting", "show", m.meetingId),
          },
        ]),
        ...navButtons(),
      ],
    };
  }

  const tasks = await myTasks(admin, colleague.id);

  if (kind === "today") {
    const due = tasks.filter((t) => t.deadline && t.deadline <= today && !t.doneAt && !t.declinedAt);
    const meetings = await myMeetings(admin, colleague.id, today);
    const todayMeetings = meetings.filter((m) => m.date === today);
    if (!due.length && !todayMeetings.length) return { text: "На сегодня за вами ничего не числится 🎉", buttons: navButtons() };
    const reply = listReply("📌 На сегодня", due, today, "");
    if (!todayMeetings.length) return reply;
    const meetingLines = todayMeetings.map((m) => `• ${m.time ? m.time + " — " : ""}${m.title}`);
    return {
      text: (due.length ? reply.text : "📌 На сегодня:") + `\n\nВстречи сегодня:\n${meetingLines.join("\n")}`,
      buttons: reply.buttons,
    };
  }

  if (kind === "overdue") {
    const overdue = tasks.filter((t) => t.deadline && t.deadline < today && !t.doneAt && !t.declinedAt);
    return listReply("⚠ Просрочено", overdue, today, "Просроченного за вами нет 👍");
  }

  if (kind === "review") {
    // «На приёмке» с его стороны — это то, что он сдал и по чему ещё не
    // ответили. Отдельный вопрос, потому что это единственное, чего человек
    // ждёт от других, а не другие от него.
    const waiting = tasks.filter((t) => t.doneAt && t.approvalState !== "returned");
    const returned = tasks.filter((t) => t.approvalState === "returned");
    if (!waiting.length && !returned.length) return { text: "Ничего не ждёт приёмки.", buttons: navButtons() };
    if (!returned.length) return listReply("🔍 Ждут приёмки", waiting, today, "");
    return listReply("↩ Вернули на доработку", returned, today, "");
  }

  const answerable = tasks.filter((t) => !t.doneAt && !t.declinedAt);
  return listReply("📋 Ваши задачи", answerable.length ? answerable : tasks, today, "Пока за вами ничего не числится.");
}

// Карточка задачи в мессенджере: то же, что человек увидел бы, открыв её в
// трекере, — и с теми же кнопками. Нужна, потому что список задач без
// возможности из него ответить — это отчёт о том, сколько всего накопилось,
// а не рабочий инструмент.
export async function taskCard(
  admin: SupabaseClient,
  colleague: { id: string; name: string; user_id: string },
  taskId: string,
  today: string,
): Promise<BotReply | null> {
  const { data } = await admin
    .from("task_participants")
    .select("role, accepted_at, done_at, done_comment, declined_at, decline_reason, reschedule_to, reschedule_reason, tasks(id, title, description, deadline, priority, status, approval_state, approval_comment, deleted_at, user_id)")
    .eq("assignee_id", colleague.id)
    .eq("task_id", taskId)
    .maybeSingle();

  type Row = {
    role: "executor" | "coexecutor" | "watcher";
    accepted_at: string | null;
    done_at: string | null;
    done_comment: string | null;
    declined_at: string | null;
    decline_reason: string | null;
    reschedule_to: string | null;
    reschedule_reason: string | null;
    tasks: {
      title: string;
      description: string | null;
      deadline: string | null;
      priority: string | null;
      status: string | null;
      approval_state: string | null;
      approval_comment: string | null;
      deleted_at: string | null;
      user_id: string;
    } | null;
  };

  const row = data as unknown as Row | null;
  const task = row?.tasks;
  if (!row || !task || task.deleted_at || task.user_id !== colleague.user_id) return null;

  const lines = [`📋 ${task.title}`];
  if (task.description) lines.push("", task.description);

  const meta: string[] = [];
  if (task.deadline) {
    meta.push(task.deadline < today && task.status !== "done" ? "⚠ просрочено: " + fmtDate(task.deadline) : "срок: " + fmtDate(task.deadline));
  }
  if (row.role === "coexecutor") meta.push("вы соисполнитель");
  if (row.role === "watcher") meta.push("вы наблюдатель");
  if (meta.length) lines.push("", meta.join(" · "));

  // Состояние — словами, а не значком: человек открыл карточку именно
  // затем, чтобы понять, чего от него ждут сейчас.
  if (task.approval_state === "returned") lines.push("", `↩ Вернули на доработку: ${task.approval_comment || "без комментария"}`);
  else if (row.done_at) lines.push("", `🏁 Вы отчитались${row.done_comment ? ": " + row.done_comment : " — комментарий не написан"}`);
  else if (row.declined_at) lines.push("", `⛔ Вы отказались${row.decline_reason ? ": " + row.decline_reason : " — причина не написана"}`);
  else if (row.accepted_at) lines.push("", "✅ Принято в работу");
  if (row.reschedule_to) lines.push(`📅 Просили перенос на ${fmtDate(row.reschedule_to)}${row.reschedule_reason ? ": " + row.reschedule_reason : ""}`);

  // Закрытая задача кнопок ответа не получает — отвечать по ней уже не за
  // что; слово сказать всё равно можно.
  const done = task.status === "done";
  const actions = done ? [[{ text: "💬 Ответить", data: encodeCallback("task", "msg", taskId) }]] : taskButtons(taskId, row.role);
  return { text: lines.join("\n"), buttons: [...actions, ...navButtons()] };
}

export async function meetingCard(
  admin: SupabaseClient,
  colleague: { id: string; name: string; user_id: string },
  meetingId: string,
): Promise<BotReply | null> {
  const { data } = await admin
    .from("meeting_participants")
    .select("response, reason, round, meetings(title, date, time, status, vote_round, participants, deleted_at, user_id)")
    .eq("assignee_id", colleague.id)
    .eq("meeting_id", meetingId)
    .maybeSingle();

  type Row = {
    response: "none" | "yes" | "no";
    reason: string | null;
    round: number;
    meetings: {
      title: string;
      date: string;
      time: string | null;
      status: string;
      vote_round: number | null;
      participants: string[] | null;
      deleted_at: string | null;
      user_id: string;
    } | null;
  };

  const row = data as unknown as Row | null;
  const meeting = row?.meetings;
  if (!row || !meeting || meeting.deleted_at || meeting.user_id !== colleague.user_id) return null;

  const answered = row.round === Number(meeting.vote_round ?? 1) && row.response !== "none";
  const lines = [`📅 ${meeting.title}`, "", fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "")];
  const others = (meeting.participants || []).filter(Boolean);
  if (others.length > 1) lines.push("Участники: " + others.join(", "));
  if (answered) lines.push("", row.response === "yes" ? "✅ Вы подтвердили участие" : `❌ Вы не сможете${row.reason ? ": " + row.reason : ""}`);
  else lines.push("", "❓ Ждём вашего ответа");

  // Передумать можно до начала — решение проекта. Поэтому кнопки голоса
  // остаются и после ответа, а не исчезают вместе с ним.
  return { text: lines.join("\n"), buttons: [...meetingButtons(meetingId), [{ text: "💬 Ответить", data: encodeCallback("meeting", "msg", meetingId) }], ...navButtons()] };
}

// Кто идёт на встречу — тот же расклад, что показывает карточка в трекере.
//
// Три состояния, а не два: не ответивший и отказавшийся — разные вещи, и
// именно эту разницу список подтвердивших выразить не мог. Опоздавший стоит
// среди идущих, потому что он идёт.
export async function meetingRoster(
  admin: SupabaseClient,
  colleague: { user_id: string },
  meetingId: string,
): Promise<string | null> {
  const { data: meetingRow } = await admin
    .from("meetings")
    .select("id, title, date, time, participants, vote_round, user_id, deleted_at")
    .eq("id", meetingId)
    .maybeSingle();
  const meeting = meetingRow as {
    title: string;
    date: string;
    time: string | null;
    participants: string[] | null;
    vote_round: number | null;
    user_id: string;
    deleted_at: string | null;
  } | null;
  if (!meeting || meeting.deleted_at || meeting.user_id !== colleague.user_id) return null;

  const round = Number(meeting.vote_round ?? 1) || 1;
  const { data: rows } = await admin
    .from("meeting_participants")
    .select("response, reason, round, late, role, assignees(name)")
    .eq("meeting_id", meetingId);

  type Row = {
    response: "none" | "yes" | "no";
    reason: string | null;
    round: number;
    late: boolean | null;
    role: string;
    assignees: { name: string } | { name: string }[] | null;
  };

  const yes: string[] = [];
  const no: string[] = [];
  const silent: string[] = [];
  for (const r of ((rows as unknown as Row[]) || [])) {
    if (r.role !== "participant") continue;
    const a = r.assignees;
    const name = (Array.isArray(a) ? a[0]?.name : a?.name) || "";
    if (!name) continue;
    // Ответ из прежнего круга ничего не говорит о новом времени.
    if (r.round < round || r.response === "none") silent.push(name);
    else if (r.response === "yes") yes.push(name + (r.late ? " (опоздает)" : ""));
    else no.push(name + (r.reason ? " — " + r.reason : ""));
  }

  const lines = [`📅 ${meeting.title}`, fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : ""), ""];
  if (yes.length) lines.push(`✅ Будут (${yes.length}):`, ...yes.map((n) => "• " + n), "");
  if (no.length) lines.push(`❌ Не смогут (${no.length}):`, ...no.map((n) => "• " + n), "");
  // Отдельной строкой и последними: «не ответил» — это не «не придёт», и
  // смешивать их значит врать организатору в обе стороны.
  if (silent.length) lines.push(`❓ Ещё не ответили (${silent.length}):`, ...silent.map((n) => "• " + n), "");
  if (!yes.length && !no.length && !silent.length) lines.push("Участников пока нет.");
  return lines.join("\n").trim();
}

export function colleagueCommandsHelp(name: string): string {
  return [
    `${name}, вот что я умею.`,
    "",
    "Спросить можно словом — своим сообщением:",
    "• «мои задачи» — всё, что за вами",
    "• «сегодня» — задачи и встречи на сегодня",
    "• «просрочено» — что уже горит",
    "• «встречи» — ближайшие, с вашим ответом по каждой",
    "• «на приёмке» — что вы сдали и что вернули",
    "",
    "Ответить по задаче — кнопками под ней: «✅ Принял», «🏁 Сделал», «⛔ Не могу».",
    "«Сделал» и «Не могу» попросят одно сообщение — что сделано или почему не выйдет; его увидит постановщик.",
    "",
    "«💬 Ответить» направляет следующее сообщение в обсуждение именно этой задачи — его увидят все её участники.",
    "",
    "Если у вас есть вход в трекер, можно и поручать отсюда: «поручи Игорю смету к пятнице». Я покажу, что понял, и создам по «да».",
    "Голосовое тоже понимаю: наговорите, распознаю и обработаю так же, как текст.",
  ].join("\n");
}
