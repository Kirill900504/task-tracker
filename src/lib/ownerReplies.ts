import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton, BotChannelConfig } from "@/lib/botTransport";
import { encodeCallback, type CallbackAction } from "@/lib/colleagues";
import { fmtDate } from "@/lib/taskDisplay";
import { progressLabel, type TaskParticipant } from "@/lib/taskProgress";
import { ownerIdeasReply, ownerListReply, ownerMeetingsReply, ownerMenu, ownerNav, personReply, type OwnerReply } from "@/lib/ownerQueries";
import { applyReview } from "@/lib/reviewWork";
import { startNewTask, whenButtons, whoButtons } from "@/lib/ownerNewTask";
import { closeMeeting } from "@/lib/meetingRecap";
import { recordEvent } from "@/lib/itemHistory";
import { actorName } from "@/lib/actorName";

// Что происходит, когда владелец нажимает кнопку.
//
// Половина трекера, которой в мессенджере не было вовсе. Кнопки под
// сообщениями получал только тот, кому что-то поручили, — а тот, кто
// поручал, мог лишь читать: чтобы принять работу, вернуть её или сдвинуть
// срок, приходилось открывать трекер. Слова Кирилла 19.09.2026: боты
// должны быть доведены «до такого состояния, чтобы через них работать
// было не менее удобно, чем через само приложение».
//
// Устройство такое же, как у ответов коллеги (colleagueReplies): функция
// получает нажатие и возвращает, что сказать, чем переписать сообщение и
// кого уведомить. Отправку делает маршрут — он один на оба мессенджера.

export type OwnerOutcome = {
  toast: string;
  // Чем переписать сообщение, под которым нажали. Переписывание — не
  // украшение: в MAX нет всплывающих подсказок, и переписанное сообщение и
  // есть весь ответ.
  rewriteTo?: string;
  rewriteButtons?: BotButton[][];
  // Отдельным сообщением: список, карточка, вопрос.
  say?: string;
  sayButtons?: BotButton[][];
  // Кому сказать, что решение принято. Исполнителям — всегда сразу: они
  // ждут ответа, и задержка стоит дороже порядка.
  tellAssignees?: { taskId: string; text: string };
  // Возврат на доработку требует слов, и следующее сообщение владельца
  // станет ими. Хранится это там же, где все незакрытые вопросы бота, —
  // в pending_action его строки (миграция 0033 сделала то же самое для
  // руководителя).
  askReturn?: { taskId: string; title: string };
  // Шаг мастера «Поручить», который надо запомнить до следующего нажатия
  // или сообщения.
  setPending?: Record<string, unknown>;
  // Последний шаг: код срока. Саму задачу заводит pipeline — там лежит
  // незакрытый вопрос с названием и людьми.
  finishNewTask?: string;
};

// Найти владельца по чату. Его чат живёт не там, где чаты коллег:
// `telegram_accounts` / `max_accounts` — это «куда писать хозяину
// трекера», а `assignees.<чат>` — «куда писать человеку, которому
// поручили». Перепутать их нельзя: подключившийся «как владелец»
// руководитель получил бы пустой трекер вместо своих задач.
export async function findOwnerByChat(
  admin: SupabaseClient,
  chatId: number,
  channel: BotChannelConfig,
): Promise<{ userId: string } | null> {
  const { data } = await admin
    .from(channel.accountsTable)
    .select("user_id")
    .eq(channel.chatColumn, chatId)
    .limit(1)
    .maybeSingle();
  const row = data as { user_id: string } | null;
  return row ? { userId: row.user_id } : null;
}

async function sectionPeople(
  admin: SupabaseClient,
  userId: string,
  sectionId: string,
): Promise<{ name: string; role: "executor" | "coexecutor" | "watcher" }[]> {
  const { data } = await admin
    .from("section_assignees")
    .select("role, assignees(name)")
    .eq("user_id", userId)
    .eq("section_id", sectionId);
  type Row = { role: "executor" | "coexecutor" | "watcher"; assignees: { name: string } | { name: string }[] | null };
  return ((data || []) as Row[])
    .map((r) => ({
      name: (Array.isArray(r.assignees) ? r.assignees[0]?.name : r.assignees?.name) || "",
      role: r.role,
    }))
    .filter((p) => p.name);
}

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  assignee: string | null;
  deadline: string | null;
  status: string | null;
  approval_state: string | null;
  approval_comment: string | null;
};

async function loadTask(admin: SupabaseClient, userId: string, taskId: string): Promise<TaskRow | null> {
  const { data } = await admin
    .from("tasks")
    .select("id, title, description, assignee, deadline, status, approval_state, approval_comment")
    .eq("id", taskId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as TaskRow | null) || null;
}

async function participantsOf(admin: SupabaseClient, taskId: string): Promise<TaskParticipant[]> {
  const { data } = await admin
    .from("task_participants")
    .select("assignee_id, role, accepted_at, done_at, done_comment, declined_at, decline_reason, assignees(name)")
    .eq("task_id", taskId);
  type Row = {
    assignee_id: string;
    role: TaskParticipant["role"];
    accepted_at: string | null;
    done_at: string | null;
    done_comment: string | null;
    declined_at: string | null;
    decline_reason: string | null;
    assignees: { name: string } | { name: string }[] | null;
  };
  return ((data || []) as Row[]).map((r) => ({
    assigneeId: r.assignee_id,
    name: (Array.isArray(r.assignees) ? r.assignees[0]?.name : r.assignees?.name) || "",
    role: r.role,
    acceptedAt: r.accepted_at,
    doneAt: r.done_at,
    doneComment: r.done_comment,
    declinedAt: r.declined_at,
    declineReason: r.decline_reason,
  }));
}

// Карточка задачи глазами того, кто её поставил.
//
// Набор кнопок здесь совсем другой, чем у исполнителя, и это главное:
// исполнителю — «принял / сделал / не могу», постановщику — «принять
// работу / вернуть / продлить / напомнить». Одна и та же задача, два
// разных вопроса к ней.
export async function ownerTaskCard(admin: SupabaseClient, userId: string, taskId: string): Promise<OwnerReply | null> {
  const task = await loadTask(admin, userId, taskId);
  if (!task) return null;
  const people = await participantsOf(admin, taskId);

  const lines = [`📋 ${task.title}`];
  if (task.description) lines.push("", task.description);
  const facts: string[] = [];
  if (task.deadline) facts.push("срок " + fmtDate(task.deadline));
  if (task.assignee) facts.push("исполнитель: " + task.assignee);
  if (facts.length) lines.push("", facts.join(" · "));
  const progress = progressLabel(people);
  if (progress) lines.push(progress);

  const reported = people.filter((p) => p.role === "executor" && p.doneAt);
  for (const p of reported) lines.push(`🏁 ${p.name}: ${p.doneComment || "без комментария"}`);
  const declined = people.filter((p) => p.declinedAt && !p.doneAt);
  for (const p of declined) lines.push(`⛔ ${p.name} не может: ${p.declineReason || "без причины"}`);

  const waiting = task.approval_state === "awaiting_review";
  if (waiting) lines.push("", "Отчитались все — задача ждёт вашего решения.");

  // Закрытая задача отвечает на другой вопрос, и кнопки у неё другие.
  // «Продлить срок» и «Напомнить» под принятой работой предлагают
  // сделать то, чего делать уже не надо, а единственное, что с ней
  // бывает нужно, — открыть заново, если закрыли не то.
  const closed = task.status === "done" || task.approval_state === "accepted";
  if (closed) lines.push("", "Задача закрыта.");

  const buttons: BotButton[][] = [];
  if (waiting) {
    buttons.push([
      { text: "✅ Принять работу", data: encodeCallback("task", "ok", taskId) },
      { text: "↩ Вернуть", data: encodeCallback("task", "back", taskId) },
    ]);
  }
  if (closed) {
    buttons.push([{ text: "🔄 Открыть заново", data: encodeCallback("task", "reop", taskId) }]);
  } else {
    buttons.push([
      { text: "📅 Продлить срок", data: encodeCallback("task", "plus", taskId) },
      { text: "🔔 Напомнить", data: encodeCallback("task", "ping", taskId) },
    ]);
  }
  buttons.push([{ text: "💬 Ответить", data: encodeCallback("task", "msg", taskId) }]);
  buttons.push(...ownerNav());

  return { text: lines.join("\n"), buttons };
}

type MeetingRow = {
  id: string;
  title: string;
  date: string;
  time: string | null;
  user_id: string;
  from_task_id: string | null;
  result: string | null;
};

async function loadMeeting(admin: SupabaseClient, userId: string, meetingId: string): Promise<MeetingRow | null> {
  const { data } = await admin
    .from("meetings")
    .select("id, title, date, time, user_id, from_task_id, result")
    .eq("id", meetingId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as MeetingRow | null) || null;
}

// Встреча глазами того, кто её собрал.
//
// «Как прошла?» бот спрашивал и раньше, но только текстом: ответить можно
// было рассказом, а «прошла, обсудили, ничего не решили» — ровно тот
// ответ, который не пишут. Встреча оставалась открытой месяцами. Теперь
// под вопросом кнопки, а рассказ остаётся для случаев, когда есть что
// рассказать.
export async function ownerMeetingCard(admin: SupabaseClient, userId: string, meetingId: string): Promise<OwnerReply | null> {
  const meeting = await loadMeeting(admin, userId, meetingId);
  if (!meeting) return null;

  const { data: votes } = await admin
    .from("meeting_participants")
    .select("response, late, reason, assignees(name)")
    .eq("meeting_id", meetingId);
  type Vote = { response: string; late: boolean | null; reason: string | null; assignees: { name: string } | { name: string }[] | null };
  const rows = ((votes || []) as Vote[]).map((v) => ({
    name: (Array.isArray(v.assignees) ? v.assignees[0]?.name : v.assignees?.name) || "",
    response: v.response,
    late: !!v.late,
    reason: v.reason || "",
  }));

  const lines = [`📅 ${meeting.title}`, fmtDate(meeting.date) + (meeting.time ? ", " + meeting.time : "")];
  const yes = rows.filter((r) => r.response === "yes");
  const no = rows.filter((r) => r.response === "no");
  const silent = rows.filter((r) => r.response === "none");
  if (yes.length) lines.push("", "✅ Будут: " + yes.map((r) => r.name + (r.late ? " (опоздает)" : "")).join(", "));
  if (no.length) lines.push("❌ Не смогут: " + no.map((r) => (r.reason ? `${r.name} — ${r.reason}` : r.name)).join(", "));
  if (silent.length) lines.push("❓ Молчат: " + silent.map((r) => r.name).join(", "));
  if (meeting.result) lines.push("", "📝 " + meeting.result);

  return {
    text: lines.join("\n"),
    buttons: [
      [
        { text: "✅ Прошла", data: encodeCallback("meeting", "mok", meetingId) },
        { text: "⚪ Без результата", data: encodeCallback("meeting", "mno", meetingId) },
      ],
      [{ text: "📝 Записать итог", data: encodeCallback("meeting", "mrec", meetingId) }],
      [{ text: "💬 Ответить", data: encodeCallback("meeting", "msg", meetingId) }],
      ...ownerNav(),
    ],
  };
}

// Насколько двигаем срок. Те же четыре шага, что и у просьбы о переносе с
// той стороны: разговор один и тот же, и мерить его надо одинаково.
export const EXTEND_OPTIONS = [
  { days: 1, label: "+1 день" },
  { days: 3, label: "+3 дня" },
  { days: 7, label: "+неделя" },
  { days: 14, label: "+2 недели" },
];

export function extendButtons(taskId: string): BotButton[][] {
  return [
    EXTEND_OPTIONS.slice(0, 2).map((o) => ({ text: o.label, data: encodeCallback("task", "plus" + o.days, taskId) })),
    EXTEND_OPTIONS.slice(2).map((o) => ({ text: o.label, data: encodeCallback("task", "plus" + o.days, taskId) })),
    [{ text: "← Отмена", data: encodeCallback("task", "oshow", taskId) }],
  ];
}

export function addDays(date: string, days: number): string {
  const base = date ? new Date(date + "T00:00:00") : new Date();
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

// Разбор нажатия. Возвращает null, если кнопка не владельческая, — тогда
// маршрут пробует обычный путь коллеги.
export async function handleOwnerCallback(
  admin: SupabaseClient,
  userId: string,
  action: CallbackAction,
  today: string,
): Promise<OwnerOutcome | null> {
  if (action.action === "omenu") {
    const menu = ownerMenu();
    return { toast: "Меню", say: menu.text, sayButtons: menu.buttons };
  }

  if (action.action === "olist") {
    const reply =
      action.kind === "meeting"
        ? await ownerMeetingsReply(admin, userId, today)
        : action.kind === "idea"
          ? await ownerIdeasReply(admin, userId)
          : await ownerListReply(admin, userId, action.id, today);
    return { toast: "Открываю", say: reply.text, sayButtons: reply.buttons };
  }

  // «💬 Ответить» — единственный способ владельцу написать в обсуждение.
  //
  // Его свободный текст в боте — поручение, а не реплика (правило про
  // руководителя в CLAUDE.md), и эта кнопка ровно для того и есть: она
  // говорит, КУДА адресован следующий текст. Кнопка стояла под каждой
  // карточкой с самого начала, а разбора у неё не было — нажатие
  // отвечало «эта кнопка не для вас», и написать в задачу из мессенджера
  // было нельзя вовсе. Замечено сквозной диагностикой 20.09.2026.
  if (action.action === "msg" && (action.kind === "task" || action.kind === "meeting")) {
    const table = action.kind === "task" ? "tasks" : "meetings";
    const { data } = await admin
      .from(table)
      .select("id, title")
      .eq("id", action.id)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    const item = data as { id: string; title: string } | null;
    if (!item) return { toast: action.kind === "task" ? "Эта задача не найдена" : "Эта встреча не найдена" };
    return {
      toast: "Пишите — отправлю в обсуждение",
      say: `💬 Следующее сообщение уйдёт в обсуждение ${action.kind === "task" ? "задачи" : "встречи"} «${item.title}».\nЕго увидят все участники.`,
      // Живёт это там же, где остальные незакрытые вопросы бота, и по тем
      // же правилам: два часа и одно сообщение (см. takeAim у коллеги).
      setPending: { kind: "owner_reply", replyKind: action.kind, itemId: item.id, title: item.title, at: new Date().toISOString() },
    };
  }

  if (action.action === "oshow" && action.kind === "task") {
    const card = await ownerTaskCard(admin, userId, action.id);
    if (!card) return { toast: "Эта задача не найдена" };
    return { toast: "Открываю", say: card.text, sayButtons: card.buttons };
  }

  if (action.action === "plus" && action.kind === "task") {
    const task = await loadTask(admin, userId, action.id);
    if (!task) return { toast: "Эта задача не найдена" };
    return {
      toast: "На сколько двигаем?",
      say: `📅 «${task.title}»\n\nТекущий срок: ${task.deadline ? fmtDate(task.deadline) : "не назначен"}. На сколько продлить?`,
      sayButtons: extendButtons(action.id),
    };
  }

  const extend = action.action.match(/^plus(\d+)$/);
  if (extend && action.kind === "task") {
    const task = await loadTask(admin, userId, action.id);
    if (!task) return { toast: "Эта задача не найдена" };
    const next = addDays(task.deadline || today, Number(extend[1]));
    if (!next) return { toast: "Не получилось посчитать дату" };
    const { error } = await admin.from("tasks").update({ deadline: next }).eq("id", action.id);
    if (error) return { toast: "Не получилось сохранить" };
    // Тот же след, что и у переноса срока из трекера. Без него история
    // задачи зависит от того, откуда нажали кнопку, — а спрашивают у неё
    // одно и то же: сколько раз эту задачу двигали и когда.
    await recordEvent(admin, {
      userId,
      kind: "task",
      itemId: action.id,
      text: `📅 Срок ${task.deadline ? "перенесён с " + fmtDate(task.deadline) + " на " : "поставлен на "}${fmtDate(next)}`,
    });
    return {
      toast: "Срок продлён",
      rewriteTo: `📅 Срок «${task.title}» — до ${fmtDate(next)}.`,
      rewriteButtons: [[{ text: "📋 Открыть задачу", data: encodeCallback("task", "oshow", action.id) }], ...ownerNav()],
      // Перенос срока — событие, а не тихая правка: человек планировал
      // неделю под прежнее число.
      tellAssignees: { taskId: action.id, text: `📅 Срок задачи «${task.title}» продлён до ${fmtDate(next)}.` },
    };
  }

  // Приёмка и возврат — те же правила, что в трекере (lib/reviewWork):
  // приёмка закрывает задачу одной записью, возврат обнуляет отчёты, и в
  // обоих случаях людям говорится сразу.
  //
  // «Принять» здесь без комментария: в мессенджере это одно нажатие в
  // ответ на отчёт, который уже прочитан выше в том же чате, и требовать
  // слова значило бы сделать самый частый ответ самым долгим. Возврату
  // слова нужны — «доделай» без «что именно» это не ответ, — поэтому он
  // спрашивает причину следующим сообщением (pending_action).
  if (action.action === "ok" && action.kind === "task") {
    const task = await loadTask(admin, userId, action.id);
    if (!task) return { toast: "Эта задача не найдена" };
    const done = await applyReview(admin, { id: task.id, title: task.title, user_id: userId }, "approve", "", {
      label: await actorName(admin, userId, userId),
      userId,
    });
    if (!done.ok) return { toast: done.error };
    return {
      toast: "Принято",
      rewriteTo: `✅ Принято: «${task.title}». Задача закрыта, исполнителям сказано.`,
      // Кнопка обратного хода стоит прямо здесь, под тем сообщением,
      // которым задачу закрыли: промахнуться по «Принять работу» в
      // телефоне легко, а искать потом закрытую задачу в списках — долго.
      rewriteButtons: [[{ text: "🔄 Открыть заново", data: encodeCallback("task", "reop", task.id) }], ...ownerNav()],
    };
  }

  // Открыть заново — единственный выход из «Завершённых», и он один на
  // трекер и на бота (lib/reviewWork.REOPEN_PATCH): снимается и статус, и
  // приёмка, отчёты остаются, исполнителям говорится.
  if (action.action === "reop" && action.kind === "task") {
    const task = await loadTask(admin, userId, action.id);
    if (!task) return { toast: "Эта задача не найдена" };
    const done = await applyReview(admin, { id: task.id, title: task.title, user_id: userId }, "reopen", "", {
      label: await actorName(admin, userId, userId),
      userId,
    });
    if (!done.ok) return { toast: done.error };
    return {
      toast: "Открыл заново",
      rewriteTo: `🔄 «${task.title}» снова в работе. Исполнителям сказано.`,
      rewriteButtons: [[{ text: "📋 Открыть задачу", data: encodeCallback("task", "oshow", task.id) }], ...ownerNav()],
    };
  }

  if (action.action === "back" && action.kind === "task") {
    const task = await loadTask(admin, userId, action.id);
    if (!task) return { toast: "Эта задача не найдена" };
    return {
      toast: "Что доделать?",
      askReturn: { taskId: task.id, title: task.title },
      say: `↩ «${task.title}»\n\nНапишите следующим сообщением, что именно доделать, — отправлю исполнителям.`,
    };
  }

  // ——— Человек: что на нём и что ему ещё поручить.
  if (action.action === "oper" && action.kind === "task") {
    const reply = await personReply(admin, userId, action.id, today);
    return { toast: "Открываю", say: reply.text, sayButtons: reply.buttons };
  }

  // «Поручить ему» — тот же мастер, но человек уже выбран: спрашиваем
  // сразу, что поручить, и следом на когда.
  if (action.action === "npers" && action.kind === "task") {
    const { data } = await admin.from("assignees").select("name").eq("id", action.id).eq("user_id", userId).maybeSingle();
    const name = (data as { name: string } | null)?.name;
    if (!name) return { toast: "Этого человека больше нет" };
    return {
      toast: name,
      say: `➕ Что поручить: ${name}? Напишите или надиктуйте.`,
      setPending: { kind: "new_task", stage: "title", people: [{ name, role: "executor" }] },
    };
  }

  // ——— Мысль: превратить в задачу или вычеркнуть.
  //
  // Входящий ящик работает в мессенджере так же, как в трекере: мысль
  // либо становится делом, либо уходит. Третьего с ней не делают, и
  // потому кнопок ровно две.
  if (action.action === "ishow" && action.kind === "idea") {
    const { data } = await admin
      .from("ideas")
      .select("id, text, important")
      .eq("id", action.id)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    const idea = data as { id: string; text: string; important: boolean } | null;
    if (!idea) return { toast: "Эта мысль не найдена" };
    return {
      toast: "Открываю",
      say: `${idea.important ? "🚩 " : "💡 "}${idea.text}`,
      sayButtons: [
        [
          { text: "➕ В задачу", data: encodeCallback("idea", "itask", idea.id) },
          { text: "✓ Вычеркнуть", data: encodeCallback("idea", "idone", idea.id) },
        ],
        ...ownerNav(),
      ],
    };
  }

  if (action.action === "idone" && action.kind === "idea") {
    const { error } = await admin
      .from("ideas")
      .update({ done: true, done_at: new Date().toISOString() })
      .eq("id", action.id)
      .eq("user_id", userId);
    if (error) return { toast: "Не получилось" };
    return { toast: "Вычеркнул", rewriteTo: "✓ Вычеркнуто.", rewriteButtons: ownerNav() };
  }

  if (action.action === "itask" && action.kind === "idea") {
    const { data } = await admin.from("ideas").select("id, text").eq("id", action.id).eq("user_id", userId).maybeSingle();
    const idea = data as { id: string; text: string } | null;
    if (!idea) return { toast: "Эта мысль не найдена" };
    // Дальше — обычный мастер, начиная со второго шага: название уже есть.
    // Сама мысль вычёркивается не сейчас, а когда задача действительно
    // заведена: брошенный на полпути мастер не должен стирать запись.
    return {
      toast: "Кому поручить?",
      say: `«${idea.text}»\n\nКому поручить?`,
      sayButtons: await whoButtons(admin, userId),
      setPending: { kind: "new_task", stage: "who", title: idea.text, fromIdea: idea.id },
    };
  }

  // ——— Встреча: открыть, закрыть, записать итог.
  if (action.action === "oshow" && action.kind === "meeting") {
    const card = await ownerMeetingCard(admin, userId, action.id);
    if (!card) return { toast: "Эта встреча не найдена" };
    return { toast: "Открываю", say: card.text, sayButtons: card.buttons };
  }

  if ((action.action === "mok" || action.action === "mno") && action.kind === "meeting") {
    const meeting = await loadMeeting(admin, userId, action.id);
    if (!meeting) return { toast: "Эта встреча не найдена" };
    const outcome = action.action === "mok" ? "success" : "no_result";
    await closeMeeting(admin, meeting, outcome, "");
    return {
      toast: outcome === "success" ? "Закрыл" : "Без результата",
      rewriteTo:
        outcome === "success"
          ? `✅ Встреча «${meeting.title}» закрыта.`
          : `⚪ Встреча «${meeting.title}» закрыта без результата.`,
      // Итог можно дописать и после: встреча закрыта, но «о чём
      // договорились» остаётся вопросом, на который ждут ответа участники.
      rewriteButtons: [[{ text: "📝 Записать итог", data: encodeCallback("meeting", "mrec", action.id) }], ...ownerNav()],
    };
  }

  // «Записать итог» ждёт слов — тем же механизмом, что и возврат задачи на
  // доработку: следующее сообщение станет итогом.
  if (action.action === "mrec" && action.kind === "meeting") {
    const meeting = await loadMeeting(admin, userId, action.id);
    if (!meeting) return { toast: "Эта встреча не найдена" };
    return {
      toast: "Слушаю",
      say: `📝 «${meeting.title}»\n\nЧто решили? Напишите или надиктуйте — запишу итогом и разошлю тем, кто был.`,
      setPending: { kind: "meeting_recap", meetingId: meeting.id, title: meeting.title },
    };
  }

  // ——— Поручить: три шага, на каждом кнопки (см. lib/ownerNewTask).
  if (action.action === "new" && action.kind === "task") {
    const started = startNewTask();
    return { toast: "Что поручить?", say: started.text, setPending: started.pending };
  }

  if (action.action === "nwho" && action.kind === "task") {
    const { data } = await admin.from("assignees").select("name").eq("id", action.id).eq("user_id", userId).maybeSingle();
    const name = (data as { name: string } | null)?.name;
    if (!name) return { toast: "Этого человека больше нет" };
    return {
      toast: name,
      say: `Кому: ${name}. На когда?`,
      sayButtons: whenButtons(),
      setPending: { kind: "new_task", stage: "when", people: [{ name, role: "executor" }] },
    };
  }

  if (action.action === "nsec" && action.kind === "task") {
    const people = await sectionPeople(admin, userId, action.id);
    if (!people.length) return { toast: "За этим разделом никто не закреплён" };
    return {
      toast: "По разделу",
      say: `Кому: ${people.map((p) => p.name).join(", ")}. На когда?`,
      sayButtons: whenButtons(),
      setPending: { kind: "new_task", stage: "when", people },
    };
  }

  if (action.action.startsWith("nwhen") && action.kind === "task") {
    // Сама задача заводится в pipeline: там лежит незакрытый вопрос с
    // названием и людьми, и там же он снимается.
    return { toast: "Завожу", finishNewTask: action.action.slice("nwhen".length) };
  }

  if (action.action === "ping" && action.kind === "task") {
    const task = await loadTask(admin, userId, action.id);
    if (!task) return { toast: "Эта задача не найдена" };
    return {
      toast: "Напомнил",
      tellAssignees: {
        taskId: action.id,
        text: `🔔 Напоминание по задаче «${task.title}»${task.deadline ? ` (срок ${fmtDate(task.deadline)})` : ""}. Что с ней?`,
      },
    };
  }

  return null;
}
