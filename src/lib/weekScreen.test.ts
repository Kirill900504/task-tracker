import { describe, it, expect } from "vitest";
import { buildWeek, startOfWeek, weekCount } from "./weekScreen";
import type { Meeting, Task } from "@/types/tracker";

function task(patch: Partial<Task>): Task {
  return {
    id: Math.random().toString(36).slice(2),
    title: "Задача",
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
    ...patch,
  };
}

function meeting(patch: Partial<Meeting>): Meeting {
  return {
    id: Math.random().toString(36).slice(2),
    date: "2026-09-23",
    time: "10:00",
    title: "Планёрка",
    participants: [],
    status: "planned",
    result: "",
    movedToDate: "",
    resolvedAt: "",
    ...patch,
  };
}

// 23.09.2026 — среда. Значит неделя началась 21-го, в понедельник.
const WEDNESDAY = new Date(2026, 8, 23, 12, 0, 0);

describe("неделя", () => {
  it("начинается с понедельника, а не с сегодняшнего дня", () => {
    // «Эта неделя» — календарная неделя. Сдвинутая на среду, она перестаёт
    // совпадать с тем, что человек называет неделей вслух.
    expect(startOfWeek(WEDNESDAY)).toBe("2026-09-21");
    expect(startOfWeek(new Date(2026, 8, 27, 12))).toBe("2026-09-21"); // воскресенье
    expect(startOfWeek(new Date(2026, 8, 21, 12))).toBe("2026-09-21"); // сам понедельник
  });

  it("раскладывает семь дней и помечает сегодняшний", () => {
    const days = buildWeek([], [], WEDNESDAY);
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.date)[0]).toBe("2026-09-21");
    expect(days.find((d) => d.isToday)?.date).toBe("2026-09-23");
    expect(days.filter((d) => d.isPast).map((d) => d.date)).toEqual(["2026-09-21", "2026-09-22"]);
  });

  it("кладёт задачу в день её срока", () => {
    const days = buildWeek([task({ deadline: "2026-09-24", title: "Смета" })], [], WEDNESDAY);
    const thursday = days.find((d) => d.date === "2026-09-24")!;
    expect(thursday.tasks.map((t) => t.title)).toEqual(["Смета"]);
  });

  it("повторяющаяся задача появляется в каждый свой день", () => {
    // Тем же правилом, которым живут календарь и карточка: второй способ
    // ответить «когда» разошёлся бы с первым.
    const days = buildWeek([task({ recur: "weekly", recurWeekdays: ["1", "4"] })], [], WEDNESDAY);
    const withTask = days.filter((d) => d.tasks.length).map((d) => d.date);
    expect(withTask).toEqual(["2026-09-21", "2026-09-24"]);
  });

  it("закрытых задач в неделе нет", () => {
    const days = buildWeek([task({ deadline: "2026-09-24", status: "done" })], [], WEDNESDAY);
    expect(weekCount(days)).toBe(0);
  });

  it("встречи идут со своим временем и только запланированные", () => {
    const days = buildWeek(
      [],
      [meeting({ date: "2026-09-23", time: "09:00" }), meeting({ date: "2026-09-23", time: "15:00" }), meeting({ date: "2026-09-23", status: "success" })],
      WEDNESDAY,
    );
    const today = days.find((d) => d.date === "2026-09-23")!;
    expect(today.meetings.map((m) => m.time)).toEqual(["09:00", "15:00"]);
  });

  it("считает всё, что на неделе, одним числом", () => {
    const days = buildWeek([task({ deadline: "2026-09-22" }), task({ deadline: "2026-09-25" })], [meeting({ date: "2026-09-23" })], WEDNESDAY);
    expect(weekCount(days)).toBe(3);
  });
});
