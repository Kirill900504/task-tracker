// Pure date/recurrence logic shared by the reminders cron route — split out
// so it's unit-testable without a database or network. This mirrors
// isDueToday()/isOverdue() in public/legacy-tracker.js; the two can't
// literally share code (one runs in the browser as plain JS, this runs in
// the Node/Vercel runtime), so a behavior change in one must be mirrored in
// the other by hand — the tests here exist to catch drift in this copy.

// Russia has used a single UTC+3 offset (no DST) since 2014 — shifting the
// UTC timestamp and reading it back with the UTC getters gives Moscow local
// wall-clock fields without needing a timezone library.
export function moscowNow(): Date {
  return new Date(Date.now() + 3 * 60 * 60 * 1000);
}

export function dateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function minutesOfDay(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export type TaskRow = {
  id: string;
  title: string;
  assignee: string;
  status: string;
  deadline: string | null;
  recur: string;
  recur_weekday: number | null;
  recur_monthday: number | null;
  recur_year_day: number | null;
  recur_year_month: number | null;
};

export function isDueToday(t: TaskRow, now: Date, today: string): boolean {
  if (t.recur === "none") return t.deadline === today;
  if (t.recur === "daily") return true;
  if (t.recur === "weekly") return now.getUTCDay() === t.recur_weekday;
  if (t.recur === "monthly") return now.getUTCDate() === t.recur_monthday;
  if (t.recur === "yearly") return now.getUTCDate() === t.recur_year_day && now.getUTCMonth() + 1 === t.recur_year_month;
  return false;
}

export function isOverdue(t: TaskRow, today: string): boolean {
  if (t.status === "done") return false;
  if (t.recur !== "none") return false;
  if (!t.deadline) return false;
  return t.deadline < today;
}
