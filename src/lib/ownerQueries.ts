import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotButton } from "@/lib/botTransport";
import { encodeCallback } from "@/lib/colleagues";
import { fmtDate } from "@/lib/taskDisplay";

// О чём владелец может спросить бота — и что он может нажать.
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

export async function ownerTasks(admin: SupabaseClient, userId: string): Promise<OwnerTaskRow[]> {
  const { data } = await admin
    .from("tasks")
    .select("id, title, assignee, deadline, status, approval_state, priority")
    .eq("user_id", userId)
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

export async function ownerMeetings(admin: SupabaseClient, userId: string, today: string): Promise<OwnerMeetingRow[]> {
  const { data } = await admin
    .from("meetings")
    .select("id, title, date, time, result, participants, status")
    .eq("user_id", userId)
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
export function ownerMenu(): OwnerReply {
  return {
    text: "Что показать?",
    buttons: [
      [
        { text: "📋 Задачи", data: encodeCallback("task", "olist", "all") },
        { text: "📌 Сегодня", data: encodeCallback("task", "olist", "today") },
      ],
      [
        { text: "⚠ Просрочено", data: encodeCallback("task", "olist", "overdue") },
        { text: "🔍 На приёмке", data: encodeCallback("task", "olist", "review") },
      ],
      [
        { text: "📅 Встречи", data: encodeCallback("meeting", "olist", "all") },
        { text: "👥 Люди", data: encodeCallback("task", "olist", "people") },
      ],
      [{ text: "➕ Поручить", data: encodeCallback("task", "new", "start") }],
    ],
  };
}

// Нижний ряд под любым экраном. «Меню» здесь не для красоты: без него
// каждый список — тупик, из которого выходят прокруткой переписки.
export function ownerNav(): BotButton[][] {
  return [
    [
      { text: "☰ Меню", data: encodeCallback("task", "omenu", "x") },
      { text: "📋 Задачи", data: encodeCallback("task", "olist", "all") },
    ],
  ];
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
export function peopleLoadReply(tasks: OwnerTaskRow[], today: string): OwnerReply {
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

  const lines = [...byName.entries()]
    .sort((a, b) => b[1].overdue - a[1].overdue || b[1].open - a[1].open)
    .map(([name, r]) => {
      const bits: string[] = [];
      if (r.overdue) bits.push(`⚠ ${r.overdue} просрочено`);
      if (r.review) bits.push(`🔍 ${r.review} на приёмке`);
      if (r.open) bits.push(`${r.open} в работе`);
      return `${name}\n   ${bits.join(" · ")}`;
    });
  return { text: `👥 Загрузка:\n\n${lines.join("\n")}`, buttons: ownerNav() };
}

export async function ownerListReply(
  admin: SupabaseClient,
  userId: string,
  which: string,
  today: string,
): Promise<OwnerReply> {
  if (which === "people") return peopleLoadReply(await ownerTasks(admin, userId), today);

  const tasks = await ownerTasks(admin, userId);

  if (which === "today") {
    const due = tasks.filter((t) => t.deadline && t.deadline <= today);
    const meetings = (await ownerMeetings(admin, userId, today)).filter((m) => m.date === today);
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

export async function ownerMeetingsReply(admin: SupabaseClient, userId: string, today: string): Promise<OwnerReply> {
  const meetings = await ownerMeetings(admin, userId, today);
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
