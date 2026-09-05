import { describe, it, expect } from "vitest";
import { draftBrief, briefIsEmpty, type BriefFacts } from "./dailyBrief";
import { draftWeekly, weeklyIsEmpty, type WeeklyFacts } from "./weeklyReview";
import { rewriteIsFaithful } from "./factGuard";
import { tasksWord } from "./plural";

function task(over: Partial<{ title: string; assignee: string; deadline: string; priority: string; daysOverdue: number; hasMeetingSoon: boolean }> = {}) {
  return { title: "Задача", assignee: "", deadline: "2026-09-05", priority: "med", daysOverdue: 0, hasMeetingSoon: false, ...over };
}
function briefFacts(over: Partial<BriefFacts> = {}): BriefFacts {
  return { today: "2026-09-05", overdue: [], dueToday: [], meetingsToday: [], meetingsTomorrow: [], totalOpen: 0, ...over };
}
function weeklyFacts(over: Partial<WeeklyFacts> = {}): WeeklyFacts {
  return { weekStart: "2026-08-29", perAssignee: [], stale: [], rescheduled: [], closedLastWeek: 0, createdLastWeek: 0, totalOpen: 0, totalOverdue: 0, ...over };
}

describe("draftBrief", () => {
  it("puts the longest-overdue task first and says why", () => {
    const facts = briefFacts({
      overdue: [task({ title: "Свежая просрочка", daysOverdue: 1 }), task({ title: "Давняя просрочка", daysOverdue: 12 })],
      totalOpen: 2,
    });
    const draft = draftBrief(facts);
    expect(draft.indexOf("Давняя просрочка")).toBeLessThan(draft.indexOf("Свежая просрочка"));
    expect(draft).toContain("срок был 12 дн. назад");
  });

  it("ranks a task tied to an upcoming meeting above a plain one due today", () => {
    const facts = briefFacts({
      dueToday: [task({ title: "Обычная" }), task({ title: "Обсуждается завтра", hasMeetingSoon: true })],
      totalOpen: 2,
    });
    const draft = draftBrief(facts);
    expect(draft.indexOf("Обсуждается завтра")).toBeLessThan(draft.indexOf("Обычная"));
    expect(draft).toContain("по этой теме встреча в ближайший день");
  });

  it("shows at most three, and counts the rest instead of listing them", () => {
    const facts = briefFacts({
      overdue: [1, 2, 3, 4, 5].map((n) => task({ title: `Задача ${n}`, daysOverdue: n })),
      totalOpen: 7,
    });
    const draft = draftBrief(facts);
    expect(draft.match(/^•/gm)?.length).toBe(3);
    expect(draft).toContain("Ещё 2");
    expect(draft).toContain("всего в работе 7 задач");
  });

  it("lists today's meetings with their time", () => {
    const facts = briefFacts({ meetingsToday: [{ title: "Планёрка", time: "11:00", participants: ["Никита Козлов"] }], totalOpen: 0 });
    expect(draftBrief(facts)).toContain("11:00 — Планёрка (Никита Козлов)");
  });

  it("counts as empty when there is nothing due and no meetings", () => {
    expect(briefIsEmpty(briefFacts({ totalOpen: 5 }))).toBe(true);
    expect(briefIsEmpty(briefFacts({ dueToday: [task()] }))).toBe(false);
  });
});

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
