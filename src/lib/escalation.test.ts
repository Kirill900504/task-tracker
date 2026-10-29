import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { alarmText, daysBetween, findStuck, nudgeText, stepFor } from "./escalation";

describe("эскалация просроченного", () => {
  it("срабатывает ровно на ступени, а не после неё", () => {
    // «Больше либо равно» означало бы, что задача, просроченная на месяц,
    // каждый день сообщает о том, что перешагнула тройку.
    expect(stepFor("2026-09-16", "2026-09-19")).toBe(3);
    expect(stepFor("2026-09-16", "2026-09-20")).toBeNull();
    expect(stepFor("2026-09-12", "2026-09-19")).toBe(7);
    expect(stepFor("2026-09-05", "2026-09-19")).toBe(14);
  });

  it("не считает ступенью то, что ещё не просрочено", () => {
    expect(stepFor("2026-09-19", "2026-09-19")).toBeNull();
    expect(stepFor("2026-09-25", "2026-09-19")).toBeNull();
  });

  it("считает дни через границу месяца", () => {
    expect(daysBetween("2026-08-30", "2026-09-06")).toBe(7);
  });

  it("переживает мусор в дате, а не падает на нём", () => {
    expect(daysBetween("", "2026-09-19")).toBe(0);
    expect(stepFor("", "2026-09-19")).toBeNull();
  });

  it("спрашивает человека словами, на которые есть кнопка", () => {
    const text = nudgeText({ title: "Смета", deadline: "2026-09-16" }, 3);
    expect(text).toContain("Смета");
    expect(text).toContain("3 дня");
    expect(text).toContain("кнопк");
  });

  it("постановщику называет, кого ждут", () => {
    const text = alarmText({ title: "Смета", deadline: "2026-09-12" }, 7, ["Игорь", "Никита"]);
    expect(text).toContain("7 дней");
    expect(text).toContain("Игорь, Никита");
  });

  it("склоняет дни по-русски", () => {
    expect(nudgeText({ title: "х", deadline: "" }, 1)).toContain("1 день");
    expect(nudgeText({ title: "х", deadline: "" }, 3)).toContain("3 дня");
    expect(nudgeText({ title: "х", deadline: "" }, 14)).toContain("14 дней");
  });
});

// Поддельная база: каждая цепочка запроса отдаёт заранее заданные строки
// своей таблицы — фильтры проверяет сам findStuck, а не построитель.
function fakeDb(tables: Record<string, unknown[]>): SupabaseClient {
  const chain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "not", "is", "in"]) q[m] = () => q;
    q.then = (ok: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: rows }).then(ok);
    return q;
  };
  return { from: (t: string) => chain(tables[t] || []) } as unknown as SupabaseClient;
}

describe("ступени просрочки молчат о закрытом", () => {
  // 28.10.2026: у задач, принятых до 20.09, status так и остался
  // in_progress, а напарник, за которого «сдали всю задачу», не отвечал —
  // и ступень будила его по задаче из «Завершённых».
  it("принятая задача со статусом in_progress не напоминает", async () => {
    const task = { id: "t1", title: "Смета", deadline: "2026-10-25", created_by: null, status: "in_progress", recur: "none" };
    const parts = [{ task_id: "t1", assignee_id: "a1", role: "executor", done_at: null, declined_at: null, assignees: { name: "Игорь" } }];
    const open = await findStuck(fakeDb({ tasks: [{ ...task, approval_state: null }], task_participants: parts }), "u", "2026-10-28");
    expect(open).toHaveLength(1);
    const accepted = await findStuck(fakeDb({ tasks: [{ ...task, approval_state: "accepted" }], task_participants: parts }), "u", "2026-10-28");
    expect(accepted).toHaveLength(0);
  });
});
