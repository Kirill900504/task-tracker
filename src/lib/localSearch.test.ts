import { describe, it, expect } from "vitest";
import { searchAll, matchesTerms, queryTerms } from "@/lib/localSearch";
import type { Idea, Meeting, Task } from "@/types/tracker";

function task(over: Partial<Task>): Task {
  return {
    id: "t1",
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
    ...over,
  };
}

function meeting(over: Partial<Meeting>): Meeting {
  return {
    id: "m1",
    date: "2026-09-04",
    time: "10:00",
    title: "Встреча",
    participants: [],
    status: "planned",
    result: "",
    movedToDate: "",
    resolvedAt: "",
    ...over,
  };
}

function idea(over: Partial<Idea>): Idea {
  return { id: "i1", text: "Мысль", important: false, done: false, createdAt: "04.09.2026 10:00", doneAt: "", ...over };
}

const DATA = {
  tasks: [
    task({ id: "t-sklad", title: "Подготовить смету по складу в Севастополе", assignee: "Игорь Витковский" }),
    task({ id: "t-done", title: "Склад: заказать стеллажи", status: "done", completedAt: "2026-09-01T10:00:00Z" }),
    task({ id: "t-other", title: "Позвонить в банк", desc: "по вопросу лимита" }),
  ],
  meetings: [
    meeting({ id: "m-sklad", title: "Совещание по складу", result: "Решили расширять" }),
    meeting({ id: "m-people", title: "Планёрка", participants: ["Никита Козлов"] }),
  ],
  ideas: [idea({ id: "i-sklad", text: "Отдельный склад под сезонные товары" }), idea({ id: "i-other", text: "Поменять поставщика упаковки" })],
};

describe("queryTerms", () => {
  it("drops words too short or too common to narrow anything", () => {
    expect(queryTerms("что там по складу")).toEqual(["склад"]);
  });

  it("returns nothing for an empty query", () => {
    expect(queryTerms("   ")).toEqual([]);
  });
});

describe("matchesTerms", () => {
  it("matches a word by its opening, so inflections count", () => {
    expect(matchesTerms("Смета по складу", queryTerms("склад"))).toBe(true);
    expect(matchesTerms("Севастополе", queryTerms("Севастополь"))).toBe(true);
  });

  it("requires every word of the query, so more words narrow the result", () => {
    expect(matchesTerms("Смета по складу в Севастополе", queryTerms("склад севастополь"))).toBe(true);
    expect(matchesTerms("Смета по складу в Москве", queryTerms("склад севастополь"))).toBe(false);
  });

  it("does not match on a shared first letter alone", () => {
    expect(matchesTerms("Склад", queryTerms("скатерть"))).toBe(false);
  });
});

describe("searchAll", () => {
  it("finds matches across tasks, meetings and ideas at once", () => {
    const ids = searchAll("склад", DATA).map((r) => r.id);
    expect(ids).toContain("t-sklad");
    expect(ids).toContain("m-sklad");
    expect(ids).toContain("i-sklad");
    expect(ids).not.toContain("t-other");
  });

  it("puts open items above finished ones", () => {
    const tasks = searchAll("склад", DATA).filter((r) => r.kind === "task");
    expect(tasks[0].id).toBe("t-sklad");
    expect(tasks[1].id).toBe("t-done");
    expect(tasks[1].done).toBe(true);
  });

  it("searches task descriptions and meeting outcomes too", () => {
    expect(searchAll("лимита", DATA).map((r) => r.id)).toContain("t-other");
    expect(searchAll("расширять", DATA).map((r) => r.id)).toContain("m-sklad");
  });

  it("finds a meeting by a participant", () => {
    expect(searchAll("Козлов", DATA).map((r) => r.id)).toContain("m-people");
  });

  it("returns nothing for an empty query", () => {
    expect(searchAll("  ", DATA)).toEqual([]);
  });

  it("shows the essentials next to each hit", () => {
    const hit = searchAll("смету", DATA)[0];
    expect(hit.meta).toContain("Игорь Витковский");
  });
});
