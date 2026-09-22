import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton } from "@/lib/botTransport";
import { encodeCallback } from "@/lib/colleagues";
import { fmtDate } from "@/lib/taskDisplay";
import { actorScope, type BotActor } from "@/lib/botActor";
import { botMenu, navRow } from "@/lib/botMenu";

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

export type OwnerView = "tasks" | "today" | "overdue" | "meetings" | "review" | "ideas" | "people" | "menu" | "help";

const PAGE = 8;

export type OwnerReply = { text: string; buttons?: BotButton[][] };

export type OwnerTaskRow = {
  id: string;
  title: string;
  assignee: string;
  deadline: string | null;
  status: string | null;
  approvalState: string | null;
  priority: string | null;
};

type TaskRaw = {
  id: string;
  title: string;
  assignee: string | null;
  deadline: string | null;
  status: string | null;
  approval_state: string | null;
  priority: string | null;
};

export async function ownerTasks(admin: SupabaseClient, actor: BotActor): Promise<OwnerTaskRow[]> {
  const { data } = await admin
    .from("tasks")
    .select("id, title, assignee, deadline, status, approval_state, priority")
    .match(actorScope(actor))
    .is("deleted_at", null)
    .neq("status", "done")
    .order("deadline", { nullsFirst: false });
  return ((data || []) as TaskRaw[]).map((t) => ({
    id: t.id,
    title: t.title,
    assignee: t.assignee || "",
    deadline: t.deadline,
    status: t.status,
    approvalState: t.approval_state,
    priority: t.priority,
  }));
}

export type OwnerMeetingRow = { id: string; title: string; date: string; time: string; result: string; participants: string[] };

export async function ownerMeetings(admin: SupabaseClient, actor: BotActor, today: string): Promise<OwnerMeetingRow[]> {
  const { data } = await admin
    .from("meetings")
    .select("id, title, date, time, result, participants, status")
    .match(actorScope(actor))
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
  return [
    "Что я умею.",
    "",
    "Просто напишите, что нужно сделать и кому — «Игорю смету к пятнице»: я разберу и спрошу «да?» перед тем, как завести. Голосовое тоже понимаю.",
    "",
    "Спросить словом:",
    "• «меню» — все разделы кнопками",
    "• «сегодня» — что на сегодня",
    "• «просрочено» — что горит",
    "• «встречи» — ближайшие",
    "",
    "По каждой задаче из списка открывается карточка: принять работу, вернуть на доработку с причиной, продлить срок, напомнить, открыть заново.",
    "",
    "«💬 Ответить» направляет следующее сообщение в обсуждение именно этой задачи — его увидят все её участники.",
  ].join("\n");
}

function mark(t: OwnerTaskRow, today: string): string {
  if (t.approvalState === "awaiting_review") return "🔍";
  if (t.deadline && t.deadline < today) return "⚠";
  if (t.deadline === today) return "📌";
  return "•";
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
    if (t.deadline) bits.push((t.deadline < today ? "просрочено " : "до ") + fmtDate(t.deadline));
    return `${mark(t, today)} ${t.title}${bits.length ? "\n   " + bits.join(" · ") : ""}`;
  });
  const more = tasks.length > PAGE ? `\n\nИ ещё ${tasks.length - PAGE} — они в трекере.` : "";
  return {
    text: `${title} (${tasks.length}):\n\n${lines.join("\n")}${more}\n\nНажмите задачу, чтобы открыть её.`,
    buttons: [
      ...shown.map((t) => [{ text: `${mark(t, today)} ${short(t.title)}`, data: encodeCallback("task", "oshow", t.id) }]),
      ...ownerNav(),
    ],
  };
}

// Кто чем занят — тот же вопрос, что и панель «Загрузка» в трекере, и тот
// же ответ: строка на человека, у которого есть о чём сказать.
export function peopleLoadReply(tasks: OwnerTaskRow[], today: string, ids: Record<string, string> = {}): OwnerReply {
  const byName = new Map<string, { open: number; overdue: number; review: number }>();
  for (const t of tasks) {
    const name = (t.assignee || "").trim();
    if (!name) continue;
    const row = byName.get(name) || { open: 0, overdue: 0, review: 0 };
    if (t.approvalState === "awaiting_review") row.review++;
    else {
      row.open++;
      if (t.deadline && t.deadline < today) row.overdue++;
    }
    byName.set(name, row);
  }
  if (!byName.size) return { text: "Никому ничего не поручено.", buttons: ownerNav() };

  const sorted = [...byName.entries()].sort((a, b) => b[1].overdue - a[1].overdue || b[1].open - a[1].open);
  const lines = sorted.map(([name, r]) => {
    const bits: string[] = [];
    if (r.overdue) bits.push(`⚠ ${r.overdue} просрочено`);
    if (r.review) bits.push(`🔍 ${r.review} на приёмке`);
    if (r.open) bits.push(`${r.open} в работе`);
    return `${name}\n   ${bits.join(" · ")}`;
  });
  // Имя — кнопка: «а что там у Игоря» задаётся сразу после того, как
  // увидел цифру напротив него, и ответ должен быть на расстоянии одного
  // нажатия, а не поиска в списке задач.
  const rows = sorted
    .filter(([name]) => ids[name])
    .map(([name]) => [{ text: short(name, 24), data: encodeCallback("task", "oper", ids[name]) }]);
  return { text: `👥 Загрузка:\n\n${lines.join("\n")}`, buttons: [...rows, ...ownerNav()] };
}

export async function ownerListReply(
  admin: SupabaseClient,
  actor: BotActor,
  which: string,
  today: string,
): Promise<OwnerReply> {
  if (which === "people") {
    // Идентификаторы нужны кнопкам: в списке задач человек назван именем,
    // а открывается его карточка по строке в списке людей.
    // Список людей общий на пространство — он и должен быть общим: имена
    // в задачах одни и те же у всех. Сужает картину не он, а сами задачи.
    const { data: people } = await admin.from("assignees").select("id, name").eq("user_id", actor.spaceId);
    const ids: Record<string, string> = {};
    for (const person of ((people || []) as { id: string; name: string }[])) ids[person.name] = person.id;
    return peopleLoadReply(await ownerTasks(admin, actor), today, ids);
  }

  if (which === "help") return { text: assignerHelp(), buttons: ownerNav() };

  // Встречи нужны только «сегодняшнему» экрану, но спросить их ВМЕСТЕ с
  // задачами дешевле, чем после: два вопроса в базу, заданные подряд,
  // стоят двух полётов туда и обратно, а заданные разом — одного.
  const [tasks, todayMeetings] = await Promise.all([
    ownerTasks(admin, actor),
    which === "today" ? ownerMeetings(admin, actor, today) : Promise.resolve([] as OwnerMeetingRow[]),
  ]);

  if (which === "today") {
    const due = tasks.filter((t) => t.deadline && t.deadline <= today);
    const meetings = todayMeetings.filter((m) => m.date === today);
    const reply = taskList("📌 На сегодня", due, today, "На сегодня ничего не назначено 🎉");
    if (!meetings.length) return reply;
    const lines = meetings.map((m) => `• ${m.time ? m.time + " — " : ""}${m.title}`);
    return { text: reply.text + `\n\nВстречи сегодня:\n${lines.join("\n")}`, buttons: reply.buttons };
  }
  if (which === "overdue") {
    return taskList("⚠ Просрочено", tasks.filter((t) => t.deadline && t.deadline < today), today, "Просроченного нет 👍");
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
    .match(actorScope(actor))
    .eq("done", false)
    .is("deleted_at", null)
    .order("important", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(PAGE);
  const ideas = (data || []) as { id: string; text: string; important: boolean }[];
  if (!ideas.length) return { text: "Мыслей пока нет. Продиктуйте — запишу.", buttons: ownerNav() };
  const lines = ideas.map((i) => `${i.important ? "🚩" : "•"} ${i.text}`);
  return {
    text: `💡 Мысли (${ideas.length}):\n\n${lines.join("\n")}`,
    buttons: [
      ...ideas.map((i) => [{ text: `${i.important ? "🚩 " : ""}${short(i.text, 26)}`, data: encodeCallback("idea", "ishow", i.id) }]),
      ...ownerNav(),
    ],
  };
}

export async function personReply(admin: SupabaseClient, actor: BotActor, assigneeId: string, today: string): Promise<OwnerReply> {
  const { data } = await admin.from("assignees").select("name").eq("id", assigneeId).eq("user_id", actor.spaceId).maybeSingle();
  const name = (data as { name: string } | null)?.name;
  if (!name) return { text: "Этого человека больше нет в списке.", buttons: ownerNav() };

  const mine = (await ownerTasks(admin, actor)).filter((t) => (t.assignee || "").trim() === name);
  const reply = taskList(`📋 ${name}`, mine, today, `За ${name} сейчас ничего не числится.`);
  return {
    text: reply.text,
    buttons: [
      [{ text: "➕ Поручить ему", data: encodeCallback("task", "npers", assigneeId) }],
      ...(reply.buttons || []),
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
