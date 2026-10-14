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
  recur_weekdays?: number[] | null;
  recur_monthday: number | null;
  recur_year_day: number | null;
  recur_year_month: number | null;
};

export function isDueToday(t: TaskRow, now: Date, today: string): boolean {
  if (t.recur === "none") return t.deadline === today;
  if (t.recur === "daily") return true;
  // Сначала массив, если пуст — старая колонка: то же правило, что в
  // taskDisplay.recurDays, и по той же причине (миграция 0032).
  if (t.recur === "weekly") {
    const many = (t.recur_weekdays || []).filter((n) => Number.isInteger(n));
    return many.length ? many.includes(now.getUTCDay()) : now.getUTCDay() === t.recur_weekday;
  }
  if (t.recur === "monthly") return now.getUTCDate() === t.recur_monthday;
  if (t.recur === "yearly") return now.getUTCDate() === t.recur_year_day && now.getUTCMonth() + 1 === t.recur_year_month;
  return false;
}

export function isOverdue(t: TaskRow, today: string): boolean {
  return overdueOn(t, today);
}

// Просрочена ли задача — одно правило на трекер, бот, сводки и отчёты, и
// оно же у доски (taskDisplay.isOverdue). Повторяющаяся задача
// просроченной не бывает: её срок — дата первого круга, а не обещание.
// 14.10.2026 нашлось, что бот, недельный отчёт и «Люди» считали просрочку
// голым «срок раньше сегодня»: ежедневная задача #75 висела у них
// «просроченной» с 24.09, а на доске — нет. Две правды об одном факте
// разошлись, как расходятся всегда (CLAUDE.md). Принимает только три
// поля, чтобы годиться любой выборке, а не одной TaskRow.
export function overdueOn(
  t: { status?: string | null; recur?: string | null; deadline?: string | null },
  today: string,
): boolean {
  if (t.status === "done") return false;
  if (t.recur && t.recur !== "none") return false;
  if (!t.deadline) return false;
  return t.deadline.slice(0, 10) < today;
}
