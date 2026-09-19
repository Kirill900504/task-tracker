import { describe, it, expect } from "vitest";
import { isTaskDueOnDate, mostRecentOccurrence, recurDays, recurLabel } from "./taskDisplay";
import type { Task } from "@/types/tracker";

function weekly(patch: Partial<Task>): Task {
  return {
    id: "t1",
    title: "Планёрка",
    desc: "",
    assignee: "",
    sectionId: "",
    priority: "med",
    term: "short",
    status: "in_progress",
    deadline: "",
    recur: "weekly",
    recurWeekday: "1",
    recurMonthday: "",
    recurYearDay: "",
    recurYearMonth: "1",
    lastCompletedOn: "",
    manualOrder: null,
    completedAt: "",
    ...patch,
  };
}

// 21.09.2026 — понедельник, значит 24-е четверг, 26-е суббота.
const MONDAY = new Date(2026, 8, 21);
const THURSDAY = new Date(2026, 8, 24);
const SATURDAY = new Date(2026, 8, 26);

describe("повтор по нескольким дням недели", () => {
  it("у старой задачи читается одиночный день", () => {
    // Переносить прежние задачи незачем: массива у них нет и не будет, а
    // правило «сначала массив, если пуст — колонка» не может ошибиться на
    // данных, которых ещё не видело.
    expect(recurDays(weekly({ recurWeekday: "3" }))).toEqual([3]);
    expect(recurDays(weekly({ recurWeekday: "3", recurWeekdays: [] }))).toEqual([3]);
  });

  it("массив старшинствует, когда он есть", () => {
    expect(recurDays(weekly({ recurWeekday: "1", recurWeekdays: ["1", "4"] }))).toEqual([1, 4]);
  });

  it("задача «по понедельникам и четвергам» приходит дважды в неделю", () => {
    const t = weekly({ recurWeekdays: ["1", "4"] });
    expect(isTaskDueOnDate(t, MONDAY)).toBe(true);
    expect(isTaskDueOnDate(t, THURSDAY)).toBe(true);
    expect(isTaskDueOnDate(t, SATURDAY)).toBe(false);
  });

  it("последний срок считается по ближайшему дню назад, а не по первому в списке", () => {
    // Задача «по понедельникам и четвергам», просмотренная в субботу:
    // последним был четверг. Если взять первый день списка, выйдет
    // понедельник — на три дня раньше, и закрытая в четверг задача снова
    // откроется.
    const t = weekly({ recurWeekdays: ["1", "4"] });
    expect(mostRecentOccurrence(t, SATURDAY)).toBe("2026-09-24");
  });

  it("пять рабочих дней называются «по будням», а не списком", () => {
    expect(recurLabel(weekly({ recurWeekdays: ["1", "2", "3", "4", "5"] }))).toContain("будням");
    expect(recurLabel(weekly({ recurWeekdays: ["0", "1", "2", "3", "4", "5", "6"] }))).toContain("Ежедневно");
  });

  it("несколько дней перечисляются в недельном порядке", () => {
    // «пн, чт» читается; «чт, пн» — спотыкает.
    const label = recurLabel(weekly({ recurWeekdays: ["4", "1"] }));
    expect(label.indexOf("пн")).toBeLessThan(label.indexOf("чт"));
  });

  it("один день по-прежнему называется как раньше", () => {
    expect(recurLabel(weekly({ recurWeekday: "3" }))).toBe("🔁 По срм");
  });
});
