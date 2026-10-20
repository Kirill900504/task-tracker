import { createAdminClient } from "@/lib/supabase/admin";
import { resolveWhen } from "@/lib/whenDate";
import { moscowNow, dateStr } from "@/lib/taskLogic";
import { plural } from "@/lib/plural";
import { MEETING_MOVE_COLUMNS, moveMeeting, moveTaskDeadline, type MeetingToMove } from "@/lib/itemMove";

// "Перенеси всё, что на пятницу, на понедельник" — one sentence instead of
// opening each item. The model only classifies the request and names the two
// days as LABELS ("friday" → "monday"); which rows that actually means, and
// the dates behind those labels, are worked out here (resolveWhen), for the
// same reason as everywhere else: it gets calendar arithmetic wrong.
//
// Nothing moves until the user says "да" — the affected items are listed
// first. A bulk edit is the one place where a misunderstanding is expensive,
// so it goes through the same confirmation as a delete.

export type BulkScope = "tasks" | "meetings" | "both";

export type BulkMoveRequest = {
  scope: BulkScope;
  from: string; // label, e.g. "friday" | "today" | "tomorrow"
  to: string;
};

export type BulkMovePlan = {
  fromDate: string;
  toDate: string;
  tasks: { id: string; title: string }[];
  meetings: { id: string; title: string; time: string }[];
};

export function describePlan(plan: BulkMovePlan): string {
  const lines: string[] = [];
  const total = plan.tasks.length + plan.meetings.length;
  lines.push(`Переношу с ${fmt(plan.fromDate)} на ${fmt(plan.toDate)} — ${total} ${plural(total, "запись", "записи", "записей")}:`);
  for (const t of plan.tasks) lines.push(`• задача: ${t.title}`);
  for (const m of plan.meetings) lines.push(`• встреча: ${m.time ? m.time + " " : ""}${m.title}`);
  return lines.join("\n");
}

function fmt(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export async function planBulkMove(userId: string, req: BulkMoveRequest): Promise<{ plan: BulkMovePlan | null; error: string | null }> {
  const now = moscowNow();
  // resolveWhen works off local Date parts, and moscowNow()'s fields read as
  // Moscow time in UTC — hand it a plain local date built from those.
  const local = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const fromDate = resolveWhen(req.from, local);
  const toDate = resolveWhen(req.to, local);

  if (!fromDate) return { plan: null, error: "Не понял, с какого дня переносить." };
  if (!toDate) return { plan: null, error: "Не понял, на какой день переносить." };
  if (fromDate === toDate) return { plan: null, error: "Дни совпадают — переносить нечего." };

  const admin = createAdminClient();
  const plan: BulkMovePlan = { fromDate, toDate, tasks: [], meetings: [] };

  if (req.scope === "tasks" || req.scope === "both") {
    const { data } = await admin
      .from("tasks")
      .select("id,title")
      .eq("user_id", userId)
      // Переносится только своё: у всех равные права (06.10.2026), и срок
      // чужой задачи двигает её постановщик, а не тот, кто сказал «перенеси
      // всё с понедельника».
      .is("created_by", null)
      .eq("deadline", fromDate)
      .eq("status", "in_progress")
      .is("deleted_at", null);
    plan.tasks = (data || []).map((t) => ({ id: t.id as string, title: t.title as string }));
  }
  if (req.scope === "meetings" || req.scope === "both") {
    const { data } = await admin
      .from("meetings")
      .select("id,title,time,status")
      .eq("user_id", userId)
      .is("created_by", null)
      .eq("date", fromDate)
      .is("deleted_at", null);
    plan.meetings = (data || [])
      .filter((m) => !m.status || m.status === "planned")
      .map((m) => ({ id: m.id as string, title: m.title as string, time: (m.time as string) || "" }));
  }

  if (!plan.tasks.length && !plan.meetings.length) {
    return { plan: null, error: `На ${fmt(fromDate)} ничего не нашёл — переносить нечего.` };
  }
  return { plan, error: null };
}

// Перенос — тот же, что у одной встречи или одной задачи (lib/itemMove),
// просто много раз. До 20.10.2026 здесь менялась только дата: встреча
// «тихо» уезжала на другой день, люди об этом не узнавали, а по прежнему
// времени у них оставались кнопки «Буду». Одиночный перенос из бота уже
// делал это правильно, и две двери с разными правилами — ровно то, что в
// этом проекте расходилось трижды. Время встречи остаётся прежним: «всё с
// пятницы на понедельник» двигает день, а не час.
export async function applyBulkMove(plan: BulkMovePlan): Promise<string> {
  const admin = createAdminClient();
  const moved: string[] = [];
  const problems: string[] = [];

  if (plan.tasks.length) {
    const { data } = await admin
      .from("tasks")
      .select("id, title, number, deadline, user_id, created_by")
      .in(
        "id",
        plan.tasks.map((t) => t.id),
      );
    let count = 0;
    for (const task of (data || []) as { id: string; title: string; number: number | null; deadline: string | null; user_id: string; created_by: string | null }[]) {
      const done = await moveTaskDeadline(admin, task, plan.toDate, task.created_by || task.user_id);
      if (done.ok) count++;
      else problems.push(`«${task.title}»: ${done.error}`);
    }
    if (count) moved.push(`${count} ${plural(count, "задача", "задачи", "задач")}`);
  }

  if (plan.meetings.length) {
    const { data } = await admin
      .from("meetings")
      .select(MEETING_MOVE_COLUMNS)
      .in(
        "id",
        plan.meetings.map((m) => m.id),
      );
    let count = 0;
    for (const meeting of (data || []) as MeetingToMove[]) {
      const done = await moveMeeting(admin, meeting, { date: plan.toDate, time: meeting.time || "" }, meeting.created_by || meeting.user_id);
      if (done.ok) count++;
      else problems.push(`«${meeting.title}»: ${done.error}`);
    }
    if (count) moved.push(`${count} ${plural(count, "встреча", "встречи", "встреч")}`);
  }

  const head = moved.length ? `✓ Перенесено на ${fmt(plan.toDate)}: ${moved.join(", ")}.` : "Ничего не перенёс.";
  const tail = [
    ...(plan.meetings.length && moved.some((m) => m.includes("встреч")) ? ["Участникам встреч сообщил «было → стало»."] : []),
    ...(problems.length ? ["⚠ Не получилось:", ...problems.map((p) => "• " + p)] : []),
  ];
  return [head, ...tail].join("\n");
}

// Exposed for the reminders/tests: today's date in the same frame the planner
// uses, so a caller can explain what "сегодня" resolved to.
export function todayIso(): string {
  return dateStr(moscowNow());
}
