import { describe, expect, it } from "vitest";
import { buildOwnerWeekly, composeOwnerWeekly, ownerWeeklyIsEmpty, type WeeklyInput, type WPart, type WTask } from "./ownerWeekly";

const NOW = new Date("2026-10-09T15:00:00Z"); // пятница, 18:00 по Москве

function task(over: Partial<WTask> = {}): WTask {
  return {
    id: "t1",
    title: "Смета",
    author: "Кирилл Кучеренко",
    createdAt: "2026-10-07T09:00:00Z",
    updatedAt: "2026-10-07T09:00:00Z",
    status: "in_progress",
    deadline: "",
    completedAt: null,
    ...over,
  };
}

function part(over: Partial<WPart> = {}): WPart {
  return {
    taskId: "t1",
    person: "Игорь Петров",
    role: "executor",
    createdAt: "2026-10-07T09:00:00Z",
    acceptedAt: null,
    doneAt: null,
    declinedAt: null,
    ...over,
  };
}

function input(over: Partial<WeeklyInput> = {}): WeeklyInput {
  return {
    people: ["Кирилл Кучеренко", "Игорь Петров", "Станислав Котов"],
    tasks: [],
    parts: [],
    meetings: [],
    ideas: [],
    ...over,
  };
}

describe("пятничный отчёт владельцу — цифры", () => {
  it("пустая неделя — пустой отчёт, а не письмо из нулей", () => {
    const w = buildOwnerWeekly(input(), NOW);
    expect(ownerWeeklyIsEmpty(w)).toBe(true);
    expect(composeOwnerWeekly(w)).toEqual([]);
  });

  it("поставил / получил считаются по строкам участия, а не по полю «Исполнитель»", () => {
    const w = buildOwnerWeekly(input({ tasks: [task()], parts: [part()] }), NOW);
    const kirill = w.people.find((p) => p.name === "Кирилл Кучеренко")!;
    const igor = w.people.find((p) => p.name === "Игорь Петров")!;
    expect(kirill.assigned).toBe(1);
    expect(kirill.assignedToOthers).toBe(1);
    expect(igor.received).toBe(1);
    expect(igor.backlog).toBe(1);
  });

  it("задача самому себе — не «получил» и не «поручил другим»", () => {
    const w = buildOwnerWeekly(
      input({ tasks: [task({ author: "Игорь Петров" })], parts: [part()] }),
      NOW,
    );
    const igor = w.people.find((p) => p.name === "Игорь Петров")!;
    expect(igor.assigned).toBe(1);
    expect(igor.assignedToOthers).toBe(0);
    expect(igor.received).toBe(0);
    expect(w.pairs).toEqual([]);
  });

  it("просрочено — по сроку задачи, только у незакрытого", () => {
    const w = buildOwnerWeekly(
      input({
        tasks: [task({ deadline: "2026-10-01" }), task({ id: "t2", deadline: "2026-10-01", status: "done", completedAt: "2026-10-08T10:00:00Z" })],
        parts: [part(), part({ taskId: "t2", doneAt: "2026-10-08T10:00:00Z" })],
      }),
      NOW,
    );
    expect(w.snapshot.overdue).toBe(1);
    expect(w.people.find((p) => p.name === "Игорь Петров")!.overdue).toBe(1);
    expect(w.snapshot.closed).toBe(1);
  });

  it("скорость отклика — от назначения до первого «принял» или «не могу»", () => {
    const w = buildOwnerWeekly(
      input({ tasks: [task()], parts: [part({ acceptedAt: "2026-10-07T13:00:00Z" })] }),
      NOW,
    );
    expect(w.reaction.avgHours).toBe(4);
    expect(w.people.find((p) => p.name === "Игорь Петров")!.avgReactHours).toBe(4);
  });

  it("молчание дольше суток видно отдельно", () => {
    const w = buildOwnerWeekly(input({ tasks: [task()], parts: [part()] }), NOW);
    expect(w.reaction.waiting).toBe(1);
  });

  it("встреча, которую перенесли, не «прошла»", () => {
    const w = buildOwnerWeekly(
      input({
        meetings: [
          { id: "m1", author: "Кирилл Кучеренко", date: "2026-10-06", status: "success", movedToDate: null, people: ["Игорь Петров"] },
          { id: "m2", author: "Кирилл Кучеренко", date: "2026-10-07", status: "no_result", movedToDate: "2026-10-12", people: ["Станислав Котов"] },
        ],
      }),
      NOW,
    );
    expect(w.snapshot.meetingsHeld).toBe(1);
    expect(w.pairs).toEqual([{ a: "Игорь Петров", b: "Кирилл Кучеренко", count: 1 }]);
  });

  it("возраст задач раскладывается по корзинам 0–2 / 3–7 / 8–14 / 15+", () => {
    const w = buildOwnerWeekly(
      input({
        tasks: [
          task({ id: "a", createdAt: "2026-10-08T15:00:00Z" }),
          task({ id: "b", createdAt: "2026-10-04T15:00:00Z" }),
          task({ id: "c", createdAt: "2026-09-28T15:00:00Z" }),
          task({ id: "d", createdAt: "2026-09-01T15:00:00Z" }),
        ],
      }),
      NOW,
    );
    expect(w.aging).toEqual([1, 1, 1, 1]);
  });

  it("забытое — ни правки, ни нажатия за семь дней; нажатие исполнителя оживляет задачу", () => {
    const old = { createdAt: "2026-09-20T09:00:00Z", updatedAt: "2026-09-20T09:00:00Z" };
    const w = buildOwnerWeekly(
      input({
        tasks: [task({ id: "a", title: "Забытая", ...old }), task({ id: "b", title: "Живая", ...old })],
        parts: [
          part({ taskId: "a", createdAt: old.createdAt }),
          part({ taskId: "b", createdAt: old.createdAt, acceptedAt: "2026-10-08T09:00:00Z" }),
        ],
      }),
      NOW,
    );
    expect(w.stale.map((s) => s.title)).toEqual(["Забытая"]);
  });

  it("сданная на неделе работа по старой задаче — тоже контакт с постановщиком", () => {
    const w = buildOwnerWeekly(
      input({
        tasks: [task({ createdAt: "2026-09-01T09:00:00Z" })],
        parts: [part({ createdAt: "2026-09-01T09:00:00Z", doneAt: "2026-10-08T09:00:00Z" })],
      }),
      NOW,
    );
    expect(w.pairs).toEqual([{ a: "Игорь Петров", b: "Кирилл Кучеренко", count: 1 }]);
    expect(w.noContact).toEqual([]);
  });

  it("без контактов называются только те, кто работал на этой неделе", () => {
    const w = buildOwnerWeekly(
      input({
        tasks: [task({ author: "Станислав Котов", id: "s" })],
        ideas: [],
      }),
      NOW,
    );
    expect(w.noContact).toEqual(["Станислав Котов"]);
    expect(w.quiet).toContain("Игорь Петров");
  });
});

describe("пятничный отчёт владельцу — текст", () => {
  it("помечен как личный и не называет никого «лучшим»", () => {
    const w = buildOwnerWeekly(input({ tasks: [task()], parts: [part({ acceptedAt: "2026-10-07T10:00:00Z" })] }), NOW);
    const text = composeOwnerWeekly(w).join("\n");
    expect(text).toContain("только для вас");
    expect(text).toContain("не рейтинг");
    expect(text).not.toMatch(/лучш|худш|место|рейтинг:/i);
  });

  it("длинный отчёт режется на письма, каждое короче предела мессенджера", () => {
    const people = Array.from({ length: 80 },(_, i) => `Человек Номер${i}`);
    const tasks = people.map((p, i) => task({ id: "t" + i, title: "Очень длинное название задачи номер " + i, author: p, createdAt: "2026-09-01T09:00:00Z", updatedAt: "2026-09-01T09:00:00Z" }));
    const parts = people.map((p, i) => part({ taskId: "t" + i, person: people[(i + 1) % people.length], createdAt: "2026-10-07T09:00:00Z" }));
    const msgs = composeOwnerWeekly(buildOwnerWeekly(input({ people, tasks, parts }), NOW));
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) expect(m.length).toBeLessThanOrEqual(3500);
    // Никто не потерялся на стыке писем.
    const all = msgs.join("\n");
    for (const p of people) expect(all).toContain(`• ${p}:`);
  });
});
