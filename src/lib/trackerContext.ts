import type { SupabaseClient } from "@supabase/supabase-js";
import { moscowNow, dateStr, isDueToday, isOverdue, type TaskRow } from "@/lib/taskLogic";

// Builds the compact snapshot of a user's tracker that the assistant reads
// before answering a free-form question ("что горит?", "сколько висит на
// Никите?", "что там по опту?"). Without this the model knows nothing about
// the user's data at all — it only ever saw the message text.
//
// Deliberately NOT the whole database (CLAUDE.md §29): descriptions and
// meeting outcomes are left out entirely, done items are limited to the
// recent past, and the whole thing is capped — see MAX_CHARS. That keeps
// both the token bill and the amount of personal data leaving the app down
// to what the question actually needs.

const MAX_CHARS = 12000;
const MEETING_WINDOW_PAST_DAYS = 30;
const MEETING_WINDOW_FUTURE_DAYS = 60;
const MAX_DONE_TASKS = 20;
const MAX_IDEAS = 40;

type MeetingContextRow = {
  title: string;
  date: string;
  time: string;
  participants: string[] | null;
  status: string;
  moved_to_date: string | null;
};

type IdeaContextRow = { text: string; important: boolean; done: boolean };

// moscowNow() returns a Date shifted so that its *UTC* fields read as Moscow
// wall-clock time, and dateStr() reads those UTC fields. So day arithmetic
// has to stay in the same frame: building a new Date from local getFullYear/
// getMonth/getDate here silently produced "завтра = сегодня".
function shiftIso(base: Date, days: number): string {
  return dateStr(new Date(base.getTime() + days * 24 * 60 * 60 * 1000));
}

function taskLine(t: TaskRow, today: string): string {
  const bits: string[] = [];
  if (t.assignee) bits.push(`исп.: ${t.assignee}`);
  if (t.deadline) bits.push(isOverdue(t, today) ? `ПРОСРОЧЕНО с ${t.deadline}` : `срок ${t.deadline}`);
  if (t.recur && t.recur !== "none") bits.push("повторяется");
  if ((t as TaskRow & { priority?: string }).priority === "high") bits.push("высокий приоритет");
  if ((t as TaskRow & { term?: string }).term === "long") bits.push("долгосрочная");
  return `- ${t.title}${bits.length ? " (" + bits.join(", ") + ")" : ""}`;
}

export async function buildTrackerContext(admin: SupabaseClient, userId: string): Promise<string> {
  const now = moscowNow();
  const today = dateStr(now);

  const [taskRes, meetingRes, ideaRes] = await Promise.all([
    admin
      .from("tasks")
      .select("id,title,assignee,status,deadline,priority,term,recur,recur_weekday,recur_monthday,recur_year_day,recur_year_month,completed_at")
      .eq("user_id", userId)
      .is("deleted_at", null),
    admin
      .from("meetings")
      .select("title,date,time,participants,status,moved_to_date")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .gte("date", shiftIso(now, -MEETING_WINDOW_PAST_DAYS))
      .lte("date", shiftIso(now, MEETING_WINDOW_FUTURE_DAYS))
      .order("date", { ascending: true }),
    admin.from("ideas").select("text,important,done").eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending: false }).limit(MAX_IDEAS),
  ]);

  const allTasks = (taskRes.data || []) as (TaskRow & { priority?: string; term?: string; completed_at?: string | null })[];
  const open = allTasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => isOverdue(t, today));
  const openRest = open.filter((t) => !isOverdue(t, today));
  const doneRecent = allTasks
    .filter((t) => t.status === "done")
    .sort((a, b) => String(b.completed_at || "").localeCompare(String(a.completed_at || "")))
    .slice(0, MAX_DONE_TASKS);

  const meetings = (meetingRes.data || []) as MeetingContextRow[];
  const planned = meetings.filter((m) => !m.status || m.status === "planned");
  const past = meetings.filter((m) => m.status && m.status !== "planned");
  const ideas = (ideaRes.data || []) as IdeaContextRow[];

  // Counting and date arithmetic are done here, in code, and handed over as
  // finished facts. Left to the model they came out wrong in testing — it
  // reported "две задачи" where there were three, and answered "завтра" with
  // a meeting two days out. Same lesson as the weekday table in quickAdd.ts:
  // give the model the answer to look up, don't make it work it out.
  const perAssignee = new Map<string, { open: number; overdue: number }>();
  for (const t of open) {
    const name = t.assignee || "(без исполнителя)";
    const entry = perAssignee.get(name) || { open: 0, overdue: 0 };
    entry.open++;
    if (isOverdue(t, today)) entry.overdue++;
    perAssignee.set(name, entry);
  }
  const weekEnd = shiftIso(now, 7);

  const sections: string[] = [];
  sections.push(`Сегодня ${today}. Это данные ЛИЧНОГО таск-трекера пользователя.`);
  sections.push(
    `Календарь: завтра = ${shiftIso(now, 1)}, послезавтра = ${shiftIso(now, 2)}, «ближайшая неделя» = с ${today} по ${weekEnd}. ` +
      "Считай «завтра» строго этой датой и никакой другой.",
  );
  sections.push(
    `Итого: активных задач ${open.length}, из них просрочено ${overdue.length}; ` +
      `запланированных встреч в ближайший месяц ${meetings.filter((m) => (!m.status || m.status === "planned") && m.date >= today).length}.`,
  );
  sections.push(
    "\n## Сколько активных задач на каждом (готовые цифры, не пересчитывай)\n" +
      (perAssignee.size
        ? [...perAssignee.entries()]
            .sort((a, b) => b[1].open - a[1].open)
            .map(([name, v]) => `- ${name}: ${v.open} активных${v.overdue ? `, из них просрочено ${v.overdue}` : ""}`)
            .join("\n")
        : "(нет активных задач)"),
  );

  // Pre-filtered "when" buckets. Asked to filter by date itself the model
  // answered "завтра" with a meeting two days out, so the three windows it
  // is actually asked about are prepared here and it only has to read one.
  const tomorrow = shiftIso(now, 1);
  const dueOn = (iso: string) => open.filter((t) => t.deadline === iso || (t.recur !== "none" && isDueToday(t, now, iso)));
  const meetingsOn = (iso: string) => meetings.filter((m) => m.date === iso && (!m.status || m.status === "planned"));
  const bucket = (label: string, iso: string) => {
    const tasksHere = dueOn(iso).map((t) => `  задача: ${t.title}${t.assignee ? " (исп.: " + t.assignee + ")" : ""}`);
    const meetsHere = meetingsOn(iso).map((m) => `  встреча: ${m.time || "--:--"} ${m.title}${m.participants?.length ? " (" + m.participants.join(", ") + ")" : ""}`);
    const body = [...tasksHere, ...meetsHere];
    return `${label} (${iso}):\n${body.length ? body.join("\n") : "  (ничего не запланировано)"}`;
  };
  const weekTasks = open.filter((t) => t.deadline && t.deadline > tomorrow && t.deadline <= weekEnd);
  const weekMeetings = meetings.filter((m) => m.date > tomorrow && m.date <= weekEnd && (!m.status || m.status === "planned"));

  sections.push("\n## Ближайшее (уже отфильтровано по датам — бери отсюда)");
  sections.push(bucket("СЕГОДНЯ", today));
  sections.push(bucket("ЗАВТРА", tomorrow));
  sections.push(
    `ДАЛЬШЕ ДО ${weekEnd}:\n` +
      ([
        ...weekTasks.map((t) => `  задача: ${t.deadline} ${t.title}${t.assignee ? " (исп.: " + t.assignee + ")" : ""}`),
        ...weekMeetings.map((m) => `  встреча: ${m.date} ${m.time || "--:--"} ${m.title}`),
      ].join("\n") || "  (ничего не запланировано)"),
  );

  sections.push(`\n## Просроченные задачи (${overdue.length})`);
  sections.push(overdue.length ? overdue.map((t) => taskLine(t, today)).join("\n") : "(нет)");

  sections.push(`\n## Активные задачи (${openRest.length})`);
  sections.push(openRest.length ? openRest.map((t) => taskLine(t, today)).join("\n") : "(нет)");

  sections.push(`\n## Запланированные встречи (${planned.length})`);
  sections.push(
    planned.length
      ? planned
          .map((m) => `- ${m.date}${m.time ? " " + m.time : ""}: ${m.title}${m.participants?.length ? " (участники: " + m.participants.join(", ") + ")" : ""}`)
          .join("\n")
      : "(нет)",
  );

  sections.push(`\n## Прошедшие встречи за последний месяц (${past.length})`);
  sections.push(
    past.length
      ? past
          .map((m) => {
            const outcome = m.status === "success" ? "успешно" : m.moved_to_date ? `перенесена на ${m.moved_to_date}` : "без результата";
            return `- ${m.date}: ${m.title} — ${outcome}${m.participants?.length ? " (участники: " + m.participants.join(", ") + ")" : ""}`;
          })
          .join("\n")
      : "(нет)",
  );

  sections.push(`\n## Недавно завершённые задачи (${doneRecent.length})`);
  sections.push(doneRecent.length ? doneRecent.map((t) => `- ${t.title}${t.assignee ? " (исп.: " + t.assignee + ")" : ""}`).join("\n") : "(нет)");

  sections.push(`\n## Мысли и идеи (${ideas.length})`);
  sections.push(ideas.length ? ideas.map((i) => `- ${i.text}${i.important ? " [важно]" : ""}${i.done ? " [отмечена]" : ""}`).join("\n") : "(нет)");

  const full = sections.join("\n");
  if (full.length <= MAX_CHARS) return full;
  // Truncating from the end keeps the sections the questions are usually
  // about (overdue, active, upcoming meetings) and drops the tail.
  return full.slice(0, MAX_CHARS) + "\n…(список сокращён)";
}
