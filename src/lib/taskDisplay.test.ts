import { describe, it, expect } from "vitest";
import type { Task } from "@/types/tracker";
import {
  isOverdue,
  isDueSoon,
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

  // Приоритет на порядок больше не влияет: поле ушло из трекера целиком
  // (20.09.2026), и задачи одной группы и одной даты стоят в порядке
  // заведения — по id, а не по значению, которого никто не задаёт.
  it("одинаковые по сроку задачи стоят в порядке заведения, важность ни при чём", () => {
    const first = baseTask({ id: "a", priority: "med" });
    const second = baseTask({ id: "b", priority: "high" });
    expect([second, first].sort((x, y) => taskSortFn(x, y, now)).map((t) => t.id)).toEqual(["a", "b"]);
  });
});

// Календарь — единственное место в трекере, где «примерно правильно»
// означает «неправильно»: дат, которых не бывает, конструктор Date не
// отвергает, а молча подменяет соседними. Эти четыре проверки написаны по
// найденным ошибкам, а не по воображаемым.
describe("последний срок повтора на датах, которых не в каждом месяце бывает", () => {
  const monthly = (day: number) => ({ recur: "monthly", recurMonthday: day }) as never;
  const yearly = (day: number, month: number) => ({ recur: "yearly", recurYearDay: day, recurYearMonth: month }) as never;

  it("«каждое 31-е», взгляд 5 марта — это 31 января, а не 3 марта", () => {
    expect(mostRecentOccurrence(monthly(31), new Date(2026, 2, 5))).toBe("2026-01-31");
  });

  it("«каждое 31-е» 31 числа — это сегодня", () => {
    expect(mostRecentOccurrence(monthly(31), new Date(2026, 0, 31))).toBe("2026-01-31");
  });

  it("«29 февраля», взгляд в невисокосном 2026 — это 29 февраля 2024", () => {
    expect(mostRecentOccurrence(yearly(29, 2), new Date(2026, 2, 10))).toBe("2024-02-29");
  });

  it("обычное число считается по-прежнему", () => {
    expect(mostRecentOccurrence(monthly(15), new Date(2026, 2, 5))).toBe("2026-02-15");
    expect(mostRecentOccurrence(yearly(1, 9), new Date(2026, 2, 5))).toBe("2025-09-01");
  });
});

describe("isDueSoon", () => {
  const base = {
    id: "t",
    title: "",
    desc: "",
    assignee: "",
    sectionId: "",
    priority: "med" as const,
    term: "short" as const,
    status: "in_progress" as const,
    recur: "none" as const,
    recurWeekday: "",
    recurMonthday: "",
    recurYearDay: "",
    recurYearMonth: "",
    lastCompletedOn: "",
    manualOrder: null,
    completedAt: "",
  };

  // Понедельник 21.09.2026 — точка отсчёта во всех проверках ниже.
  const monday = new Date("2026-09-21T09:00:00");

  it("предупреждает за три рабочих дня", () => {
    expect(isDueSoon({ ...base, deadline: "2026-09-24" }, monday)).toBe(true);
  });

  it("молчит, когда до срока больше трёх рабочих дней", () => {
    expect(isDueSoon({ ...base, deadline: "2026-09-25" }, monday)).toBe(false);
  });

  it("не считает выходные: в пятницу предупреждает о среде", () => {
    // Пятница 25.09 → среда 30.09 это ровно три рабочих дня (пн, вт, ср),
    // хотя календарных пять. Календарный счёт молчал бы до вторника.
    const friday = new Date("2026-09-25T09:00:00");
    expect(isDueSoon({ ...base, deadline: "2026-09-30" }, friday)).toBe(true);
  });

  it("не дублирует просрочку", () => {
    expect(isDueSoon({ ...base, deadline: "2026-09-18" }, monday)).toBe(false);
  });

  it("молчит у сделанного и у бессрочного", () => {
    expect(isDueSoon({ ...base, deadline: "2026-09-22", status: "done" }, monday)).toBe(false);
    expect(isDueSoon({ ...base, deadline: "" }, monday)).toBe(false);
  });
});
