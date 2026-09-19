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

// В какие дни недели повторяется задача.
//
// Сначала массив, если он пуст — старая одиночная колонка. Переносить
// прежние задачи незачем: правило короче любого переноса и не может
// ошибиться на данных, которых ещё не видело (миграция 0032).
export function recurDays(task: Task): number[] {
  const many = (task.recurWeekdays || []).map(Number).filter((n) => Number.isInteger(n));
  if (many.length) return many;
  const one = Number(task.recurWeekday);
  return Number.isNaN(one) ? [] : [one];
}

export function isDueToday(task: Task, now: Date = new Date()): boolean {
  if (task.recur === "none") return task.deadline === todayStr(now);
  if (task.recur === "daily") return true;
  if (task.recur === "weekly") return recurDays(task).includes(now.getDay());
  if (task.recur === "monthly") return String(now.getDate()) === String(task.recurMonthday);
  if (task.recur === "yearly") {
    return String(now.getDate()) === String(task.recurYearDay) && String(now.getMonth() + 1) === String(task.recurYearMonth);
  }
  return false;
}

export function isTaskDueOnDate(task: Task, d: Date): boolean {
  if (task.recur === "none") return task.deadline === dateStr(d);
  if (task.recur === "daily") return true;
  if (task.recur === "weekly") return recurDays(task).includes(d.getDay());
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
  if (task.recur === "daily") return dateStr(ref);
  if (task.recur === "weekly") {
    const wd = ref.getDay();
    // Ближайший из назначенных дней, считая назад: у задачи «по
    // понедельникам и четвергам», просмотренной в пятницу, последним был
    // четверг, а не понедельник.
    const diffs = recurDays(task).map((target) => (wd - target + 7) % 7);
    if (!diffs.length) return null;
    const diff = Math.min(...diffs);
    return dateStr(new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - diff));
  }
  if (task.recur === "monthly") {
    const day = Number(task.recurMonthday);
    if (!day) return null;
    return lastDayBefore(ref, day, null);
  }
  if (task.recur === "yearly") {
    const yday = Number(task.recurYearDay);
    const ymonth = Number(task.recurYearMonth) - 1;
    if (!yday) return null;
    return lastDayBefore(ref, yday, ymonth);
  }
  return null;
}

// Когда это число было в последний раз — считая назад и ПРОПУСКАЯ месяцы,
// в которых его не бывает.
//
// Прежний расчёт строил дату конструктором и верил результату, а тот
// переполняется молча: `new Date(2026, 1, 31)` — это 3 марта, а
// `new Date(2026, 1, 29)` в невисокосном году — 1 марта. Обе подмены
// выглядят как настоящие даты и попадали в ответ: задача «каждое 31-е»,
// открытая 5 марта, считала последним сроком 3 марта (правильный ответ —
// 31 января), а «29 февраля» — 1 марта вместо 29 февраля 2024.
//
// Стоило это того, что задача-повтор либо не сбрасывалась в работу, когда
// пора, либо сбрасывалась зря: `mostRecentOccurrence` ровно для этого и
// считается. Ошибка редкая по календарю и постоянная по последствиям —
// такие и живут годами.
//
// Перебор назад, а не арифметика: 48 месяцев хватает и на 29 февраля
// (високосный год не дальше четырёх лет назад), и на любое 31-е.
function lastDayBefore(ref: Date, day: number, month: number | null): string | null {
  const start = month === null ? ref.getMonth() : ref.getMonth() + 12;
  for (let back = 0; back <= 48; back++) {
    const y = ref.getFullYear();
    const m = month === null ? start - back : month;
    const year = month === null ? y : y - back;
    const candidate = new Date(year, m, day);
    // Конструктор переполнился — значит такого дня в этом месяце нет.
    if (candidate.getDate() !== day) continue;
    if (candidate.getTime() <= ref.getTime()) return dateStr(candidate);
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
  if (t.recur === "weekly") {
    const days = recurDays(t);
    // Пять рабочих дней подряд — это «по будням», и называть их списком
    // значит заставлять читателя складывать их в голове самому.
    const workweek = [1, 2, 3, 4, 5];
    if (days.length === 5 && workweek.every((d) => days.includes(d))) return "🔁 По будням";
    if (days.length === 7) return "🔁 Ежедневно";
    // Порядок недельный, а не тот, в котором нажимали: «пн, чт» читается,
    // «чт, пн» — спотыкает.
    const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    return "🔁 По " + sorted.map((d) => weekdayName(d).toLowerCase() + "м").join(", ");
  }
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

// Три РАБОЧИХ дня до срока — и на карточке появляется восклицательный знак.
//
// Просьба Кирилла 19.09.2026: «за три рабочих дня до попадания в просрочку
// выводить маленькую иконку „восклицательного знака в правом верхнем углу“
// (выглядеть должно аккуратно и не раздражающе)».
//
// Рабочих, а не календарных, и это не придирка: в пятницу «через три дня» —
// это понедельник, то есть предупреждение приходит ровно тогда, когда
// сделать уже нечего. Считаются будни между сегодня и сроком; выходные не
// в счёт, потому что в них не работают.
//
// Уже просроченное сюда не попадает: у него свой, более громкий вид, и два
// сигнала об одном и том же — это шум.
export const SOON_WORKDAYS = 3;

export function workdaysUntil(deadline: string, now: Date = new Date()): number {
  if (!deadline) return Number.POSITIVE_INFINITY;
  const due = new Date(deadline + "T00:00:00");
  if (Number.isNaN(due.getTime())) return Number.POSITIVE_INFINITY;
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (due <= from) return 0;
  let days = 0;
  const cursor = new Date(from);
  while (cursor < due) {
    cursor.setDate(cursor.getDate() + 1);
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) days++;
  }
  return days;
}

export function isDueSoon(task: Task, now: Date = new Date()): boolean {
  if (task.status === "done") return false;
  if (!task.deadline) return false;
  if (isOverdue(task, now)) return false;
  const left = workdaysUntil(task.deadline, now);
  return left > 0 && left <= SOON_WORKDAYS;
}
