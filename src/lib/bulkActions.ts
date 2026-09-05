import { createAdminClient } from "@/lib/supabase/admin";
import { resolveWhen } from "@/lib/meetingNotes";
import { moscowNow, dateStr } from "@/lib/taskLogic";
import { plural } from "@/lib/plural";

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

export async function applyBulkMove(plan: BulkMovePlan): Promise<string> {
  const admin = createAdminClient();
  const done: string[] = [];

  if (plan.tasks.length) {
    const { error } = await admin
      .from("tasks")
      .update({ deadline: plan.toDate })
      .in(
        "id",
        plan.tasks.map((t) => t.id),
      );
    if (error) return "Не получилось перенести задачи: " + error.message;
    done.push(`${plan.tasks.length} ${plural(plan.tasks.length, "задача", "задачи", "задач")}`);
  }
  if (plan.meetings.length) {
    const { error } = await admin
      .from("meetings")
      .update({ date: plan.toDate })
      .in(
        "id",
        plan.meetings.map((m) => m.id),
      );
    if (error) return "Не получилось перенести встречи: " + error.message;
    done.push(`${plan.meetings.length} ${plural(plan.meetings.length, "встреча", "встречи", "встреч")}`);
  }

  return `✓ Перенесено на ${fmt(plan.toDate)}: ${done.join(", ")}.`;
}

// Exposed for the reminders/tests: today's date in the same frame the planner
// uses, so a caller can explain what "сегодня" resolved to.
export function todayIso(): string {
  return dateStr(moscowNow());
}
