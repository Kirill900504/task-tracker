import { describe, it, expect } from "vitest";
import type { Task } from "@/types/tracker";
import {
  isOverdue,
  isDueToday,
  isDueTodayHighlight,
  mostRecentOccurrence,
  refreshRecurringStatuses,
  taskSortFn,
  rankOf,
} from "./taskDisplay";

function baseTask(overrides: Partial<Task>): Task {
  return {
    id: "t1",
    title: "test",
    desc: "",
    assignee: "",
    sectionId: "",
    priority: "med",
    term: "short",
    status: "in_progress",
    deadline: "",
    recur: "none",
    recurWeekday: "1",
    recurMonthday: "",
    recurYearDay: "",
    recurYearMonth: "1",
    lastCompletedOn: "",
    manualOrder: null,
    completedAt: "",
    ...overrides,
  };
}

describe("isOverdue", () => {
  it("is true for a non-recurring, not-done task with a past deadline", () => {
    const t = baseTask({ deadline: "2026-08-01" });
    expect(isOverdue(t, new Date(2026, 8, 2))).toBe(true);
  });
  it("is false once done, or for a recurring task, or with no deadline", () => {
    expect(isOverdue(baseTask({ deadline: "2026-08-01", status: "done" }), new Date(2026, 8, 2))).toBe(false);
    expect(isOverdue(baseTask({ deadline: "2026-08-01", recur: "daily" }), new Date(2026, 8, 2))).toBe(false);
    expect(isOverdue(baseTask({}), new Date(2026, 8, 2))).toBe(false);
  });
});

describe("isDueToday / isDueTodayHighlight", () => {
  it("a daily recurring task is always due today", () => {
    expect(isDueToday(baseTask({ recur: "daily" }))).toBe(true);
  });
  it("a weekly task is due only on its weekday", () => {
    const t = baseTask({ recur: "weekly", recurWeekday: "3" }); // Wednesday
    expect(isDueToday(t, new Date(2026, 8, 2))).toBe(true); // 2026-09-02 is a Wednesday
    expect(isDueToday(t, new Date(2026, 8, 3))).toBe(false);
  });
  it("highlight is false once done even if otherwise due today", () => {
    const t = baseTask({ recur: "daily", status: "done" });
    expect(isDueTodayHighlight(t, new Date(2026, 8, 2))).toBe(false);
  });
});

describe("mostRecentOccurrence", () => {
  it("daily: today itself", () => {
    expect(mostRecentOccurrence(baseTask({ recur: "daily" }), new Date(2026, 8, 2))).toBe("2026-09-02");
  });
  it("weekly: the most recent matching weekday on/before ref", () => {
    // 2026-09-02 is Wednesday (3); asking for weekday 1 (Monday) should land on 2026-08-31
    const t = baseTask({ recur: "weekly", recurWeekday: "1" });
    expect(mostRecentOccurrence(t, new Date(2026, 8, 2))).toBe("2026-08-31");
  });
  it("monthly: this month's day if not yet reached, else falls back to last month", () => {
    const t = baseTask({ recur: "monthly", recurMonthday: "15" });
    expect(mostRecentOccurrence(t, new Date(2026, 8, 20))).toBe("2026-09-15");
    expect(mostRecentOccurrence(t, new Date(2026, 8, 10))).toBe("2026-08-15");
  });
});

describe("refreshRecurringStatuses", () => {
  it("resets a done recurring task to in_progress once a new period has started", () => {
    const t = baseTask({ recur: "daily", status: "done", lastCompletedOn: "2026-09-01" });
    const { tasks, changed } = refreshRecurringStatuses([t], new Date(2026, 8, 2));
    expect(changed).toBe(true);
    expect(tasks[0].status).toBe("in_progress");
    expect(tasks[0]).not.toBe(t); // new object, not a mutation of the original
    expect(t.status).toBe("done"); // original untouched
  });

  it("leaves a done recurring task alone if already completed for the current period", () => {
    const t = baseTask({ recur: "daily", status: "done", lastCompletedOn: "2026-09-02" });
    const { tasks, changed } = refreshRecurringStatuses([t], new Date(2026, 8, 2));
    expect(changed).toBe(false);
    expect(tasks[0]).toBe(t); // untouched, same reference — nothing to sync
  });

  it("never touches a one-time (non-recurring) task, however old its completion", () => {
    const t = baseTask({ recur: "none", status: "done", lastCompletedOn: "2020-01-01" });
    const { tasks, changed } = refreshRecurringStatuses([t], new Date(2026, 8, 2));
    expect(changed).toBe(false);
    expect(tasks[0].status).toBe("done");
  });
});

describe("rankOf / taskSortFn", () => {
  const now = new Date(2026, 8, 2);

  it("groups overdue before due-today before no-deadline before future", () => {
    const overdue = baseTask({ id: "a", deadline: "2026-08-01" });
    const today = baseTask({ id: "b", deadline: "2026-09-02" });
    const noDeadline = baseTask({ id: "c" });
    const future = baseTask({ id: "d", deadline: "2026-12-01" });
    expect(rankOf(overdue, now)).toBe(0);
    expect(rankOf(today, now)).toBe(1);
    expect(rankOf(noDeadline, now)).toBe(2);
    expect(rankOf(future, now)).toBe(3);

    const sorted = [future, noDeadline, today, overdue].sort((a, b) => taskSortFn(a, b, now));
    expect(sorted.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("manual order wins over automatic urgency sort once set on both", () => {
    const a = baseTask({ id: "a", deadline: "2026-08-01", manualOrder: 1 }); // overdue but manually placed second
    const b = baseTask({ id: "b", manualOrder: 0 }); // no deadline but manually placed first
    expect([a, b].sort((x, y) => taskSortFn(x, y, now)).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("high priority sorts before medium within the same group/date", () => {
    const med = baseTask({ id: "a", priority: "med" });
    const high = baseTask({ id: "b", priority: "high" });
    expect([med, high].sort((x, y) => taskSortFn(x, y, now)).map((t) => t.id)).toEqual(["b", "a"]);
  });
});
