import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton } from "@/lib/botTransport";
import { encodeCallback } from "@/lib/colleagues";
import { fmtDate } from "@/lib/taskDisplay";
import { isDueToday, moscowNow, overdueOn, type TaskRow } from "@/lib/taskLogic";
import { actorScope, authorFilter, type BotActor } from "@/lib/botActor";
import { botMenu, navRow } from "@/lib/botMenu";
import { numbered } from "@/lib/taskRef";

// О чём ПОСТАНОВЩИК может спросить бота — и что он может нажать.
//
// «Постановщик» здесь — роль по задаче, а не место в системе: половина
// эта была владельческой до 20.09.2026, и руководитель, поставивший
// задачу, не мог принять по ней работу из мессенджера вовсе. Теперь
// каждая выборка сужается актором (lib/botActor): владелец видит всё
// своё пространство, остальные — то, что поставили сами.
//
// До сих пор кнопки в мессенджере были только у коллег: нажатие искало
// человека по `assignees.<чат>`, а чат владельца живёт в другой таблице, и
// его нажатие отвечало «этот чат не подключён». То есть он мог сколько
// угодно получать сообщения и отвечать словами — но не нажать ничего.
//
// Просьба Кирилла 19.09.2026: дописать ботов «до такого состояния, чтобы
// через них работать было не менее удобно, чем через само приложение»,
// начиная с «максимально эффективных наборов кнопок на все случаи жизни».
// Это первая половина: то, что он видит и на что нажимает.
//
// Устройство то же, что у коллеги (colleagueQueries), и намеренно: два
// разных языка кнопок в одном боте — это два бота. Разница в содержании, а
// не в форме: коллега отвечает за свою работу, владелец смотрит на чужую.

export type OwnerView = "tasks" | "today" | "overdue" | "meetings" | "review" | "ideas" | "menu" | "help";

const PAGE = 8;

export type OwnerReply = { text: string; buttons?: BotButton[][] };

export type OwnerTaskRow = {
  id: string;
  title: string;
  // Номер (миграция 0045) — первым в строке списка и в кнопке.
  number?: number | null;
  assignee: string;
  deadline: string | null;
  status: string | null;
  approvalState: string | null;
  priority: string | null;
  // Повтор — ради одного правила просрочки и «сегодня» с трекером
  // (taskLogic.overdueOn / isDueToday): без него ежедневная задача с
  // давней датой первого круга читалась бы просроченной.
  row: TaskRow;
};

type TaskRaw = {
  id: string;
  title: string;
  number?: number | null;
  assignee: string | null;
  deadline: string | null;
  status: string | null;
  approval_state: string | null;
  priority: string | null;
  recur: string | null;
  recur_weekday: number | null;
  recur_weekdays: number[] | null;
  recur_monthday: number | null;
  recur_year_day: number | null;
  recur_year_month: number | null;
  recur_workday?: boolean | null;
  task_participants?: { role: string; done_at: string | null; declined_at: string | null }[] | null;
};

// «На приёмке» — тем же правилом, что столбец доски (lib/kanban.columnOf):
// отметка постановщика ИЛИ «ответили все исполнители». Только отметки
// мало: её ставит ответ через маршрут, а исполнителя, который так и не
// ответил, можно снять с задачи — остальные тогда «ответили все», доска
// показывает приёмку, а бот её не видел. Принятая и возвращённая задачи
// своё слово уже сказали.
export function effectiveApproval(
  approval: string | null,
  parts: { role: string; done_at: string | null; declined_at: string | null }[],
): string | null {
  if (approval === "awaiting_review" || approval === "accepted" || approval === "returned") return approval;
  const executors = parts.filter((p) => p.role === "executor");
  if (executors.length && executors.every((p) => p.done_at || p.declined_at)) return "awaiting_review";
  return approval;
}

export async function ownerTasks(admin: SupabaseClient, actor: BotActor): Promise<OwnerTaskRow[]> {
  const { data } = await admin
    .from("tasks")
    .select("id, title, number, assignee, deadline, status, approval_state, priority, recur, recur_weekday, recur_weekdays, recur_monthday, recur_year_day, recur_year_month, recur_workday, task_participants(role, done_at, declined_at)")
    .match(actorScope(actor)).or(authorFilter(actor))
    .is("deleted_at", null)
    .neq("status", "done")
    .order("deadline", { nullsFirst: false });
  return ((data || []) as TaskRaw[]).map((t) => ({
    id: t.id,
    title: t.title,
    number: t.number ?? null,
    assignee: t.assignee || "",
    deadline: t.deadline,
    status: t.status,
    approvalState: effectiveApproval(t.approval_state, t.task_participants || []),
    priority: t.priority,
    row: {
      id: t.id,
      title: t.title,
      assignee: t.assignee || "",
      status: t.status || "",
      deadline: t.deadline,
      recur: t.recur || "none",
      recur_weekday: t.recur_weekday,
      recur_weekdays: t.recur_weekdays,
      recur_monthday: t.recur_monthday,
      recur_year_day: t.recur_year_day,
      recur_year_month: t.recur_year_month,
      recur_workday: t.recur_workday,
    },
  }));
}

export type OwnerMeetingRow = { id: string; title: string; date: string; time: string; result: string; participants: string[] };

export async function ownerMeetings(admin: SupabaseClient, actor: BotActor, today: string): Promise<OwnerMeetingRow[]> {
  const { data } = await admin
    .from("meetings")
    .select("id, title, date, time, result, participants, status")
    .match(actorScope(actor)).or(authorFilter(actor))
    .is("deleted_at", null)
    .in("status", ["planned", "proposed"])
    .gte("date", today)
    .order("date")
    .order("time");
  return ((data || []) as { id: string; title: string; date: string; time: string | null; result: string | null; participants: string[] | null }[]).map((m) => ({
    id: m.id,
    title: m.title,
    date: m.date,
    time: m.time || "",
    result: m.result || "",
    participants: m.participants || [],
  }));
}

// Главное меню — то, чего в боте не было вовсе.
//
// Кнопка жила под тем сообщением, которым что-то прислали: переписка
// уезжала вверх, и человек, открывший чат через неделю, не видел ни одной.
// Меню — это «здесь можно что-то нажать», сказанное один раз и доступное
// из любого места: каждый экран носит внизу «☰ Меню».
//
// Сами разделы переехали в `lib/botMenu`: у получателя теперь ровно то же
// меню, сужаемое ролью, и держать их в двух файлах значило бы обновлять
// половину и забывать половину.
export function ownerMenu(): OwnerReply {
  return botMenu("assigner");
}

// Нижний ряд под любым экраном. «Меню» здесь не для красоты: без него
// каждый список — тупик, из которого выходят прокруткой переписки.
export function ownerNav(): BotButton[][] {
  return navRow("assigner");
}

// Справка постановщика. Появилась вместе с кнопкой «❓ Помощь» в меню:
// до этого справка была только у получателя, а тот, кто ставит задачи,
// узнавал о возможностях бота, наткнувшись на них.
//
// Главное здесь — первая строка. Свободный текст постановщика это
// ПОРУЧЕНИЕ, а не реплика, и человек, не знающий этого, пишет боту
// заметку для себя и получает вопрос «завести задачу?».
export function assignerHelp(): string {
  // Аудит ботов 20.10.2026: справка перечисляла четыре слова и поручения,
  // а бот умел вдвое больше — встречи, перенос, отмену, приёмку, людей,
  // общее время, напоминания, мысли, чек-лист, повестку. Умение, о котором
  // человек не знает, для него не существует. Подробности по каждому — в
  // справочнике (lib/botGuide), к нему ведёт последняя строка.
  return [
    "Что я умею. Пишите или говорите обычными словами — я покажу, что понял, и спрошу «да?», если это касается других.",
    "",
    "Задачи",
    "• «Игорю смету к пятнице» — поручу; «завтра позвонить в банк» — запишу вам",
    "• «смету принимаю» / «верни смету — нет подписи»",
    "• «сдвинь срок сметы на пятницу», «отложи смету до понедельника»",
    "• «подключи к смете Наталью», «смету теперь ведёт Игорь»",
    "• «к смете пункты: цены, подпись» — чек-лист",
    "• «напомни Игорю про смету», «поторопи всех по просроченным»",
    "",
    "Встречи",
    "• «встреча с Игорем завтра в 11 про склад» — проверю занятость и разошлю приглашения",
    "• «когда мы с Игорем свободны в четверг?»",
    "• «перенеси планёрку на 26.10», «отмени встречу с банком, клиент заболел»",
    "• «позови Наталью на планёрку», «на планёрку добавь пункт про закупки»",
    "",
    "Себе",
    "• мысль — просто напишите её; «мысль про склад — задачей Игорю»",
    "• «напомни завтра в 9 про смету»",
    "• «меня не будет до пятницы», «я вернулся»",
    "",
    "Посмотреть",
    "• «сегодня», «просрочено», «встречи», «меню»",
    "• «что у меня завтра?», «найди всё про Севастополь»",
    "",
    "«💬 Ответить» под задачей или встречей — следующее сообщение уйдёт в её обсуждение.",
    "",
    "Не знаете, как что-то сделать, — спросите: «как отложить задачу?», «как отправить мысль коллеге?».",
  ].join("\n");
}

function mark(t: OwnerTaskRow, today: string): string {
  if (t.approvalState === "awaiting_review") return "🔍";
  if (overdueOn(t.row, today)) return "⚠";
  if (dueToday(t, today)) return "📌";
  return "•";
}

// «На сегодня» — разовая с этим сроком или повторяющаяся, чей день сегодня;
// тем же правилом, что трекер (taskLogic.isDueToday).
function dueToday(t: OwnerTaskRow, today: string): boolean {
  return isDueToday(t.row, moscowNow(), today);
}

function short(title: string, limit = 28): string {
  return title.length > limit ? title.slice(0, limit - 1) + "…" : title;
}

function taskList(title: string, tasks: OwnerTaskRow[], today: string, empty: string): OwnerReply {
  if (!tasks.length) return { text: empty, buttons: ownerNav() };
  const shown = tasks.slice(0, PAGE);
  const lines = shown.map((t) => {
    const bits: string[] = [];
    if (t.assignee) bits.push(t.assignee);
    if (t.deadline && t.row.recur === "none") bits.push((overdueOn(t.row, today) ? "просрочено " : "до ") + fmtDate(t.deadline));
    return `${mark(t, today)} ${numbered(t)}${bits.length ? "\n   " + bits.join(" · ") : ""}`;
  });
  const more = tasks.length > PAGE ? `\n\nИ ещё ${tasks.length - PAGE} — они в трекере.` : "";
  return {
    text: `${title} (${tasks.length}):\n\n${lines.join("\n")}${more}\n\nНажмите задачу, чтобы открыть её.`,
    buttons: [
      ...shown.map((t) => [{ text: `${mark(t, today)} ${short(numbered(t))}`, data: encodeCallback("task", "oshow", t.id) }]),
      ...ownerNav(),
    ],
  };
}

export async function ownerListReply(
  admin: SupabaseClient,
  actor: BotActor,
  which: string,
  today: string,
): Promise<OwnerReply> {
  if (which === "help") return { text: assignerHelp(), buttons: ownerNav() };

  // Встречи нужны только «сегодняшнему» экрану, но спросить их ВМЕСТЕ с
  // задачами дешевле, чем после: два вопроса в базу, заданные подряд,
  // стоят двух полётов туда и обратно, а заданные разом — одного.
  const [tasks, todayMeetings] = await Promise.all([
    ownerTasks(admin, actor),
    which === "today" ? ownerMeetings(admin, actor, today) : Promise.resolve([] as OwnerMeetingRow[]),
  ]);

  if (which === "today") {
    const due = tasks.filter((t) => overdueOn(t.row, today) || dueToday(t, today));
    const meetings = todayMeetings.filter((m) => m.date === today);
    const reply = taskList("📌 На сегодня", due, today, "На сегодня ничего не назначено 🎉");
    if (!meetings.length) return reply;
    const lines = meetings.map((m) => `• ${m.time ? m.time + " — " : ""}${m.title}`);
    return { text: reply.text + `\n\nВстречи сегодня:\n${lines.join("\n")}`, buttons: reply.buttons };
  }
  if (which === "overdue") {
    return taskList("⚠ Просрочено", tasks.filter((t) => overdueOn(t.row, today)), today, "Просроченного нет 👍");
  }
  if (which === "review") {
    // Самое ценное для постановщика: по этим задачам от него ждут решения,
    // и пока он молчит, работа стоит сделанной, но не принятой.
    return taskList(
      "🔍 Ждут вашей приёмки",
      tasks.filter((t) => t.approvalState === "awaiting_review"),
      today,
      "Ничего не ждёт приёмки.",
    );
  }
  return taskList("📋 Задачи", tasks, today, "Открытых задач нет.");
}

// Мысли — входящий ящик, и в мессенджере он тот же самый. Записывать их
// бот умел давно (быстрый ввод разбирает «запиши мысль…»), а вот
// достать обратно было нечем: список жил только в трекере.
export async function ownerIdeasReply(admin: SupabaseClient, actor: BotActor): Promise<OwnerReply> {
  const { data } = await admin
    .from("ideas")
    .select("id, text, important, created_at")
    .match(actorScope(actor)).or(authorFilter(actor))
    .eq("done", false)
    .is("deleted_at", null)
    .order("important", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(PAGE);
  const ideas = (data || []) as { id: string; text: string; important: boolean }[];
  // «Записать» — первой кнопкой. Отзыв Витовского 25.09.2026: «Мысли —
  // только открывает список мыслей, но не даёт возможность написать». У
  // владельца была обходная дорога («запиши мысль…» свободным текстом), у
  // руководителя свободный текст — поручение, и дороги не было вовсе.
  const write = [{ text: "✍️ Записать мысль", data: encodeCallback("idea", "inew", "x") }];
  if (!ideas.length) return { text: "Мыслей пока нет.", buttons: [write, ...ownerNav()] };
  const lines = ideas.map((i) => `${i.important ? "🚩" : "•"} ${i.text}`);
  return {
    text: `💡 Мысли (${ideas.length}):\n\n${lines.join("\n")}`,
    buttons: [
      write,
      ...ideas.map((i) => [{ text: `${i.important ? "🚩 " : ""}${short(i.text, 26)}`, data: encodeCallback("idea", "ishow", i.id) }]),
      ...ownerNav(),
    ],
  };
}

export async function ownerMeetingsReply(admin: SupabaseClient, actor: BotActor, today: string): Promise<OwnerReply> {
  const meetings = await ownerMeetings(admin, actor, today);
  if (!meetings.length) return { text: "Встреч впереди нет.", buttons: ownerNav() };
  const shown = meetings.slice(0, PAGE);
  const lines = shown.map((m) => `• ${fmtDate(m.date)}${m.time ? ", " + m.time : ""} — ${m.title}`);
  return {
    text: `📅 Встречи (${meetings.length}):\n\n${lines.join("\n")}`,
    buttons: [
      ...shown.map((m) => [{ text: `${fmtDate(m.date)} ${short(m.title, 20)}`, data: encodeCallback("meeting", "oshow", m.id) }]),
      ...ownerNav(),
    ],
  };
}

// Кнопки под утренней сводкой.
//
// Сводка перечисляет ровно то, что требует решения: что ждёт приёмки, что
// просрочено, кто молчит. Дочитав её, человек должен иметь под рукой то,
// чем на это ответить, — иначе сводка остаётся чтением, а работа
// откладывается до компьютера.
export function briefButtons(): BotButton[][] {
  return [
    [
      { text: "🔍 На приёмке", data: encodeCallback("task", "olist", "review") },
      { text: "⚠ Просрочено", data: encodeCallback("task", "olist", "overdue") },
    ],
    [
      { text: "➕ Поручить", data: encodeCallback("task", "new", "start") },
      { text: "☰ Меню", data: encodeCallback("task", "omenu", "x") },
    ],
  ];
}
