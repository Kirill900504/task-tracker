import { describe, it, expect } from "vitest";
import { peopleLoad } from "./peoplePanel";
import type { Task } from "@/types/tracker";

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

const NAMES = ["Игорь Витковский", "Никита Козлов", "Наталья Есина"];
const LONG_AGO = "2020-01-01";

describe("панель «Люди»", () => {
  it("считает то, что спрашивают: сколько в работе, что горит, кто молчит", () => {
    const rows = peopleLoad(
      [
        task({ assignee: "Игорь Витковский", deadline: LONG_AGO }),
        task({ assignee: "Игорь Витковский", acceptedAt: "2026-09-18T10:00:00Z" }),
        task({ assignee: "Никита Козлов", acceptedAt: "2026-09-18T10:00:00Z" }),
      ],
      NAMES,
    );
    const igor = rows.find((r) => r.name === "Игорь Витковский")!;
    expect(igor.open).toBe(2);
    expect(igor.overdue).toBe(1);
    // Молчит только по той, где не нажал ничего.
    expect(igor.silent).toBe(1);
  });

  it("сданное не считается «в работе»", () => {
    // Задача на приёмке ждёт не человека, а Кирилла. Сложить её с долгом
    // человека значит показать ему работу, которой у него нет.
    const [only] = peopleLoad([task({ assignee: "Никита Козлов", approvalState: "awaiting_review" })], NAMES);
    expect(only.review).toBe(1);
    expect(only.open).toBe(0);
  });

  it("закрытые не считаются вовсе", () => {
    expect(peopleLoad([task({ assignee: "Никита Козлов", status: "done" })], NAMES)).toEqual([]);
  });

  it("людей без работы в панели нет", () => {
    // Она отвечает на «у кого что», а не «кто у нас есть» — для второго
    // существует «Команда».
    const rows = peopleLoad([task({ assignee: "Игорь Витковский" })], NAMES);
    expect(rows.map((r) => r.name)).toEqual(["Игорь Витковский"]);
  });

  it("сверху тот, у кого горит", () => {
    const rows = peopleLoad(
      [
        task({ assignee: "Никита Козлов" }),
        task({ assignee: "Никита Козлов" }),
        task({ assignee: "Наталья Есина", deadline: LONG_AGO }),
      ],
      NAMES,
    );
    // У Никиты задач больше, у Натальи — просроченная. Идти первым надо к ней.
    expect(rows[0].name).toBe("Наталья Есина");
  });

  it("задача без исполнителя не приписывается никому", () => {
    expect(peopleLoad([task({ assignee: "" }), task({ assignee: "   " })], NAMES)).toEqual([]);
  });
});
