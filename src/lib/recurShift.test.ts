import { describe, expect, it } from "vitest";
import { isDayOff, monthlyHits, shiftedOccurrence, yearlyHits } from "./recurShift";
import { isTaskDueOnDate, mostRecentOccurrence, recurLabel } from "./taskDisplay";
import { isDueToday } from "./taskLogic";
import type { Task } from "@/types/tracker";

// Месяцы с нуля, как у Date: 10 — ноябрь.
describe("recurShift — число, выпавшее на выходной, встаёт на рабочий день", () => {
  it("1 ноября 2026 — воскресенье, задача встаёт на 2-е (пример Котова)", () => {
    expect(isDayOff(2026, 10, 1)).toBe(true);
    expect(shiftedOccurrence(2026, 10, 1, true)).toEqual({ y: 2026, m0: 10, d: 2 });
    expect(monthlyHits(2026, 10, 2, 1, true)).toBe(true);
    expect(monthlyHits(2026, 10, 1, 1, true)).toBe(false);
  });

  it("без галочки — всё как раньше, и в воскресенье тоже", () => {
    expect(monthlyHits(2026, 10, 1, 1, false)).toBe(true);
    expect(monthlyHits(2026, 10, 2, 1, false)).toBe(false);
  });

  it("суббота уезжает через воскресенье на понедельник", () => {
    // 1 августа 2026 — суббота.
    expect(shiftedOccurrence(2026, 7, 1, true)).toEqual({ y: 2026, m0: 7, d: 3 });
  });

  it("перенос переходит в следующий месяц: 31 октября 2026 (сб) → 2 ноября", () => {
    expect(monthlyHits(2026, 10, 2, 31, true)).toBe(true);
    expect(monthlyHits(2026, 9, 31, 31, true)).toBe(false);
  });

  it("новогодние каникулы: 1 января 2027 → 11 января (9–10 — выходные)", () => {
    expect(shiftedOccurrence(2027, 0, 1, true)).toEqual({ y: 2027, m0: 0, d: 11 });
  });

  it("4 ноября — праздник, даже в среду", () => {
    expect(isDayOff(2026, 10, 4)).toBe(true);
    expect(shiftedOccurrence(2026, 10, 4, true)).toEqual({ y: 2026, m0: 10, d: 5 });
  });

  it("в будний день ничего не двигается", () => {
    expect(shiftedOccurrence(2026, 9, 15, true)).toEqual({ y: 2026, m0: 9, d: 15 });
  });

  it("31-го в коротком месяце нет — как и без галочки", () => {
    expect(shiftedOccurrence(2026, 1, 31, true)).toBeNull();
  });

  it("ежегодная 31 декабря 2027 (пт) — на месте; 2028-го (вс) — в январь 2029-го", () => {
    expect(yearlyHits(2027, 11, 31, 31, 11, true)).toBe(true);
    // 31.12.2028 — воскресенье, дальше каникулы: 9 января 2029 — вторник.
    expect(yearlyHits(2029, 0, 9, 31, 11, true)).toBe(true);
  });
});

const base = {
  id: "t", title: "Отчёт", desc: "", assignee: "", sectionId: "", priority: "med", term: "short",
  status: "in_progress", deadline: "", recur: "monthly", recurWeekday: "1", recurWeekdays: [],
  recurMonthday: "1", recurYearDay: "", recurYearMonth: "1", lastCompletedOn: "", manualOrder: null, completedAt: "",
} as unknown as Task;

describe("доска и крон видят перенос одинаково", () => {
  it("доска: срок 2 ноября, а не 1-го", () => {
    const t = { ...base, recurWorkday: true };
    expect(isTaskDueOnDate(t, new Date(2026, 10, 1))).toBe(false);
    expect(isTaskDueOnDate(t, new Date(2026, 10, 2))).toBe(true);
  });

  it("последний круг на 1 ноября — 1 октября, а не 1 ноября", () => {
    const t = { ...base, recurWorkday: true };
    expect(mostRecentOccurrence(t, new Date(2026, 10, 1))).toBe("2026-10-01");
    expect(mostRecentOccurrence(t, new Date(2026, 10, 3))).toBe("2026-11-02");
  });

  it("крон (московские поля через UTC)", () => {
    const row = {
      id: "t", title: "", assignee: "", status: "in_progress", deadline: null, recur: "monthly",
      recur_weekday: null, recur_monthday: 1, recur_year_day: null, recur_year_month: null, recur_workday: true,
    };
    expect(isDueToday(row, new Date(Date.UTC(2026, 10, 1, 9)), "2026-11-01")).toBe(false);
    expect(isDueToday(row, new Date(Date.UTC(2026, 10, 2, 9)), "2026-11-02")).toBe(true);
  });

  it("подпись говорит о переносе", () => {
    expect(recurLabel({ ...base, recurWorkday: true })).toBe("🔁 Каждое 1 число, в рабочий день");
    expect(recurLabel(base)).toBe("🔁 Каждое 1 число");
  });
});
