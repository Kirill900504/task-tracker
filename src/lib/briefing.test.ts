import { describe, it, expect } from "vitest";
import { draftWeekly, weeklyIsEmpty, type WeeklyFacts } from "./weeklyReview";
import { rewriteIsFaithful } from "./factGuard";
import { tasksWord } from "./plural";

function weeklyFacts(over: Partial<WeeklyFacts> = {}): WeeklyFacts {
  return { weekStart: "2026-08-29", perAssignee: [], stale: [], rescheduled: [], closedLastWeek: 0, createdLastWeek: 0, totalOpen: 0, totalOverdue: 0, ...over };
}

describe("draftWeekly", () => {
  it("reports the week's totals and per-person load", () => {
    const draft = draftWeekly(
      weeklyFacts({
        perAssignee: [
          { name: "Никита Козлов", open: 4, overdue: 2 },
          { name: "Наталья Мамакова", open: 1, overdue: 0 },
        ],
        closedLastWeek: 3,
        createdLastWeek: 5,
        totalOpen: 5,
        totalOverdue: 2,
      }),
    );
    expect(draft).toContain("закрыто 3, заведено 5");
    expect(draft).toContain("Никита Козлов: 4 задачи в работе, просрочено 2");
    expect(draft).toContain("Больше всех загружен Никита Козлов");
  });

  it("does not call anyone the busiest when the load is even", () => {
    const draft = draftWeekly(
      weeklyFacts({
        perAssignee: [
          { name: "Первый", open: 3, overdue: 0 },
          { name: "Второй", open: 3, overdue: 0 },
        ],
        totalOpen: 6,
      }),
    );
    expect(draft).not.toContain("Больше всех загружен");
  });

  it("calls out stalled tasks and repeatedly postponed meetings", () => {
    const draft = draftWeekly(
      weeklyFacts({
        stale: [{ title: "Забытая задача", assignee: "Игорь", daysUntouched: 21 }],
        rescheduled: [{ title: "Встреча по сайту", times: 3 }],
        totalOpen: 1,
      }),
    );
    expect(draft).toContain("Забытая задача (Игорь) — 21 дн.");
    expect(draft).toContain("Встреча по сайту — переносилась 3 раз(а)");
  });

  it("is empty only when there is no activity at all", () => {
    expect(weeklyIsEmpty(weeklyFacts())).toBe(true);
    expect(weeklyIsEmpty(weeklyFacts({ createdLastWeek: 1 }))).toBe(false);
  });
});

describe("rewriteIsFaithful", () => {
  const draft = "Главное на сегодня (2):\n• Согласовать прайс — Никита Козлов (срок был 4 дн. назад)\nВсего в работе 3 задачи.";

  it("accepts a reworded version that keeps the numbers and the titles", () => {
    expect(rewriteIsFaithful(draft, "Сегодня 2 главных дела: согласовать прайс (Никита Козлов) — срок был 4 дн. назад. Всего в работе 3 задачи.", ["Согласовать прайс"])).toBe(true);
  });

  it("rejects a number that was not in the draft", () => {
    // The real failure: it reported "ещё 6 задач" when there were three.
    expect(rewriteIsFaithful(draft, "Главное: согласовать прайс. Ещё 6 задач в работе.", ["Согласовать прайс"])).toBe(false);
  });

  it("rejects a version that dropped the task title", () => {
    expect(rewriteIsFaithful(draft, "Сегодня 2 дела, у Никиты Козлова просрочка 4 дн. Всего 3 задачи.", ["Согласовать прайс"])).toBe(false);
  });

  it("rejects an empty answer", () => {
    expect(rewriteIsFaithful(draft, "", [])).toBe(false);
  });
});

describe("tasksWord", () => {
  it("agrees with the number", () => {
    expect(tasksWord(1)).toBe("задача");
    expect(tasksWord(3)).toBe("задачи");
    expect(tasksWord(7)).toBe("задач");
    expect(tasksWord(11)).toBe("задач");
    expect(tasksWord(21)).toBe("задача");
    expect(tasksWord(0)).toBe("задач");
  });
});
