import { describe, it, expect } from "vitest";
import { dateStr, minutesOfDay, isDueToday, isOverdue, type TaskRow } from "./taskLogic";

function baseTask(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: "t1",
    title: "test",
    assignee: "",
    status: "in_progress",
    deadline: null,
    recur: "none",
    recur_weekday: null,
    recur_monthday: null,
    recur_year_day: null,
    recur_year_month: null,
    ...overrides,
  };
}

describe("dateStr / minutesOfDay", () => {
  it("formats a UTC date as YYYY-MM-DD using the UTC fields", () => {
    // Deliberately picks a date where UTC and local calendar day could
    // differ, to make sure we're reading UTC getters, not local ones.
    const d = new Date(Date.UTC(2026, 8, 2, 3, 0)); // 2026-09-02 03:00 UTC
    expect(dateStr(d)).toBe("2026-09-02");
  });

  it("converts hours/minutes into minutes-since-midnight", () => {
    const d = new Date(Date.UTC(2026, 8, 2, 14, 30));
    expect(minutesOfDay(d)).toBe(14 * 60 + 30);
  });
});

describe("isOverdue", () => {
  it("is true for a non-recurring, not-done task with a past deadline", () => {
    const t = baseTask({ deadline: "2026-08-01", status: "in_progress" });
    expect(isOverdue(t, "2026-09-02")).toBe(true);
  });

  it("is false once the task is done", () => {
    const t = baseTask({ deadline: "2026-08-01", status: "done" });
    expect(isOverdue(t, "2026-09-02")).toBe(false);
  });

  it("is false for recurring tasks (recur !== none never counts as overdue)", () => {
    const t = baseTask({ deadline: "2026-08-01", recur: "daily" });
    expect(isOverdue(t, "2026-09-02")).toBe(false);
  });

  it("is false with no deadline set", () => {
    const t = baseTask({ deadline: null });
    expect(isOverdue(t, "2026-09-02")).toBe(false);
  });

  it("is false when the deadline is today or in the future", () => {
    expect(isOverdue(baseTask({ deadline: "2026-09-02" }), "2026-09-02")).toBe(false);
    expect(isOverdue(baseTask({ deadline: "2026-09-03" }), "2026-09-02")).toBe(false);
  });
});

describe("isDueToday", () => {
  const now = new Date(Date.UTC(2026, 8, 2, 10, 0)); // Wednesday 2026-09-02 UTC

  it("none: due exactly on the deadline date", () => {
    expect(isDueToday(baseTask({ recur: "none", deadline: "2026-09-02" }), now, "2026-09-02")).toBe(true);
    expect(isDueToday(baseTask({ recur: "none", deadline: "2026-09-01" }), now, "2026-09-02")).toBe(false);
  });

  it("daily: always due", () => {
    expect(isDueToday(baseTask({ recur: "daily" }), now, "2026-09-02")).toBe(true);
  });

  it("weekly: due when recur_weekday matches today's UTC weekday", () => {
    // 2026-09-02 is a Wednesday -> getUTCDay() === 3
    expect(isDueToday(baseTask({ recur: "weekly", recur_weekday: 3 }), now, "2026-09-02")).toBe(true);
    expect(isDueToday(baseTask({ recur: "weekly", recur_weekday: 4 }), now, "2026-09-02")).toBe(false);
  });

  it("monthly: due when recur_monthday matches today's date-of-month", () => {
    expect(isDueToday(baseTask({ recur: "monthly", recur_monthday: 2 }), now, "2026-09-02")).toBe(true);
    expect(isDueToday(baseTask({ recur: "monthly", recur_monthday: 15 }), now, "2026-09-02")).toBe(false);
  });

  it("yearly: due when both day and month match", () => {
    expect(
      isDueToday(baseTask({ recur: "yearly", recur_year_day: 2, recur_year_month: 9 }), now, "2026-09-02"),
    ).toBe(true);
    expect(
      isDueToday(baseTask({ recur: "yearly", recur_year_day: 2, recur_year_month: 10 }), now, "2026-09-02"),
    ).toBe(false);
  });
});
