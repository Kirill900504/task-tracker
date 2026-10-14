import { describe, expect, it } from "vitest";
import { deadlineNote, defaultDeadline, newTaskRow } from "./newTask";

// Срок обязателен у любой задачи (14.10.2026). Сервер не сохраняет задачу
// без срока ни одной дверью: не назван — неделя рабочим днём, и бот об
// этом говорит.
describe("срок по умолчанию", () => {
  const wed = new Date(2026, 9, 14); // среда
  const fri = new Date(2026, 9, 16); // пятница

  it("через неделю, и не на выходной", () => {
    expect(defaultDeadline(wed)).toBe("2026-10-21");
    expect(defaultDeadline(fri)).toBe("2026-10-23");
    expect(defaultDeadline(new Date(2026, 9, 17))).toBe("2026-10-26"); // суббота + 7 = суббота → понедельник
  });

  it("строка задачи без срока получает срок", () => {
    const row = newTaskRow({ id: "t1", userId: "u", title: "Позвонить" });
    expect(row.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(newTaskRow({ id: "t2", userId: "u", title: "x", deadline: "2026-11-01" }).deadline).toBe("2026-11-01");
  });

  it("бот говорит о сроке, только если поставил его сам", () => {
    expect(deadlineNote("2026-11-01", wed)).toBe("");
    expect(deadlineNote(undefined, wed)).toContain("21.10.2026");
  });
});
