import type { Meeting, Task } from "@/types/tracker";
import { isDueTodayHighlight, isOverdue, taskSortFn, todayStr } from "@/lib/taskDisplay";
import { addDaysIso } from "@/lib/calendarLogic";

// What belongs on the phone's first screen: the answer to "what do I have
// right now", and nothing else. Everything here is derived — no new state,
// no new source of truth, so it can never disagree with the lists it is
// drawn from.

export type TodayData = {
  overdue: Task[];
  dueToday: Task[];
  meetingsToday: Meeting[];
  meetingsTomorrow: Meeting[];
  // Tasks with no date at all: shown as a count, not a list — they are not
  // today's business, but pretending they do not exist is how things get
  // forgotten.
  undatedCount: number;
};

function openTask(t: Task): boolean {
  return t.status !== "done";
}

function plannedOn(meetings: Meeting[], date: string): Meeting[] {
  return meetings
    .filter((m) => m.date === date && (!m.status || m.status === "planned"))
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

export function buildToday(tasks: Task[], meetings: Meeting[], now: Date = new Date()): TodayData {
  const today = todayStr(now);
  const open = tasks.filter(openTask);

  return {
    overdue: open.filter((t) => isOverdue(t, now)).sort((a, b) => taskSortFn(a, b, now)),
    dueToday: open.filter((t) => !isOverdue(t, now) && isDueTodayHighlight(t, now)).sort((a, b) => taskSortFn(a, b, now)),
    meetingsToday: plannedOn(meetings, today),
    meetingsTomorrow: plannedOn(meetings, addDaysIso(today, 1)),
    undatedCount: open.filter((t) => !t.deadline && t.recur === "none").length,
  };
}

// How much is actually waiting on you today — drives the count on the tab,
// so the number matches what opening it shows.
export function todayCount(data: TodayData): number {
  return data.overdue.length + data.dueToday.length + data.meetingsToday.length;
}
