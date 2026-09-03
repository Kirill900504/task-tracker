// Pure task-list display logic, ported from legacy-tracker.js's client-side
// recurrence/sort/label helpers (isDueToday, isTaskDueOnDate, isOverdue,
// isDueTodayHighlight, mostRecentOccurrence, rankOf/sortFn, priorityLabel/
// Class, recurLabel). Deliberately NOT the same functions as
// src/lib/taskLogic.ts — those are the server's Moscow-fixed-offset mirror
// used by the reminders cron; this file is the browser's local-time version
// used for what the user actually sees on screen, exactly as
// legacy-tracker.js kept them separate (see taskLogic.ts's own top comment
// for why the two can't be unified).
import type { Task } from "@/types/tracker";

export function pad(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

export function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr(now: Date = new Date()): string {
  return dateStr(now);
}

export function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

const WEEKDAY_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
export function weekdayName(n: number): string {
  return WEEKDAY_NAMES[n];
}

export function isDueToday(task: Task, now: Date = new Date()): boolean {
  if (task.recur === "none") return task.deadline === todayStr(now);
  if (task.recur === "daily") return true;
  if (task.recur === "weekly") return String(now.getDay()) === String(task.recurWeekday);
  if (task.recur === "monthly") return String(now.getDate()) === String(task.recurMonthday);
  if (task.recur === "yearly") {
    return String(now.getDate()) === String(task.recurYearDay) && String(now.getMonth() + 1) === String(task.recurYearMonth);
  }
  return false;
}

export function isTaskDueOnDate(task: Task, d: Date): boolean {
  if (task.recur === "none") return task.deadline === dateStr(d);
  if (task.recur === "daily") return true;
  if (task.recur === "weekly") return String(d.getDay()) === String(task.recurWeekday);
  if (task.recur === "monthly") return String(d.getDate()) === String(task.recurMonthday);
  if (task.recur === "yearly") {
    return String(d.getDate()) === String(task.recurYearDay) && String(d.getMonth() + 1) === String(task.recurYearMonth);
  }
  return false;
}

// The most recent date (on/before `ref`) this recurring task was due —
// used to decide whether a "done" recurring task's completion is stale
// (from a previous period) and should reset to in_progress.
export function mostRecentOccurrence(task: Task, ref: Date): string | null {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  if (task.recur === "daily") return dateStr(ref);
  if (task.recur === "weekly") {
    const wd = ref.getDay();
    const target = Number(task.recurWeekday);
    if (Number.isNaN(target)) return null;
    const diff = (wd - target + 7) % 7;
    return dateStr(new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - diff));
  }
  if (task.recur === "monthly") {
    const day = Number(task.recurMonthday);
    if (!day) return null;
    let candidate = new Date(y, m, day);
    if (candidate.getTime() > ref.getTime()) candidate = new Date(y, m - 1, day);
    return dateStr(candidate);
  }
  if (task.recur === "yearly") {
    const yday = Number(task.recurYearDay);
    const ymonth = Number(task.recurYearMonth) - 1;
    if (!yday) return null;
    let yc = new Date(y, ymonth, yday);
    if (yc.getTime() > ref.getTime()) yc = new Date(y - 1, ymonth, yday);
    return dateStr(yc);
  }
  return null;
}

export function isOverdue(task: Task, now: Date = new Date()): boolean {
  if (task.status === "done") return false;
  if (task.recur !== "none") return false;
  if (!task.deadline) return false;
  return task.deadline < todayStr(now);
}

export function isDueTodayHighlight(task: Task, now: Date = new Date()): boolean {
  if (task.status === "done") return false;
  if (task.recur === "none") return task.deadline === todayStr(now);
  return isDueToday(task, now);
}

export function priorityLabel(p: Task["priority"]): string {
  return p === "high" ? "Высокий" : "Средний";
}
export function priorityClass(p: Task["priority"]): string {
  return p === "high" ? "pill-high" : "pill-med";
}

export function recurLabel(t: Task): string {
  if (t.recur === "none") return "";
  if (t.recur === "daily") return "🔁 Ежедневно";
  if (t.recur === "weekly") return "🔁 По " + weekdayName(Number(t.recurWeekday)).toLowerCase() + "м";
  if (t.recur === "monthly") return "🔁 Каждое " + t.recurMonthday + " число";
  if (t.recur === "yearly") return "🔁 Ежегодно " + t.recurYearDay + "." + pad(Number(t.recurYearMonth));
  return "";
}

// Group order (top to bottom): 0 overdue, 1 due today, 2 no deadline, 3
// future deadline.
export function rankOf(t: Task, now: Date = new Date()): number {
  if (isOverdue(t, now)) return 0;
  if (isDueTodayHighlight(t, now)) return 1;
  if (!t.deadline) return 2;
  return 3;
}

// Manual drag order always wins (once the user has ever dragged anything in
// a column); otherwise sorted by urgency group, then deadline, then
// priority, then insertion order (id) as a stable tie-break.
export function taskSortFn(a: Task, b: Task, now: Date = new Date()): number {
  const am = a.manualOrder != null;
  const bm = b.manualOrder != null;
  if (am && bm) return (a.manualOrder as number) - (b.manualOrder as number);
  if (am !== bm) return am ? -1 : 1;

  const ao = rankOf(a, now);
  const bo = rankOf(b, now);
  if (ao !== bo) return ao - bo;

  if (ao === 0 || ao === 3) {
    const ad = a.deadline || "";
    const bd = b.deadline || "";
    if (ad !== bd) return ad < bd ? -1 : 1;
  }

  if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

// Refreshes recurring tasks whose completion is from a past period back to
// in_progress. Pure — returns a NEW array (only a new array if anything
// actually changed, so callers can skip persisting when nothing did) rather
// than mutating in place, unlike its legacy-tracker.js counterpart which
// mutated `tasks` directly (safe there only because shadow was, by then,
// already a deep clone — see trackerSync.ts).
export function refreshRecurringStatuses(tasks: Task[], now: Date = new Date()): { tasks: Task[]; changed: boolean } {
  let changed = false;
  const next = tasks.map((t) => {
    if (t.recur === "none" || t.status !== "done") return t;
    const period = mostRecentOccurrence(t, now);
    if (!period) return t;
    if (!t.lastCompletedOn || t.lastCompletedOn < period) {
      changed = true;
      return { ...t, status: "in_progress" as const };
    }
    return t;
  });
  return { tasks: changed ? next : tasks, changed };
}
