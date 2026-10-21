import { describe, it, expect } from "vitest";
import { isSelfAssignee, DEFAULT_ASSIGNEES, taskToRow, taskFromRow } from "./trackerRows";
import type { Task } from "@/types/tracker";

describe("isSelfAssignee", () => {
  it("recognises the owner's own row, and nobody else's", () => {
    expect(isSelfAssignee("Кирилл (я)")).toBe(true);
    // Trailing space is what an assignee typed by hand tends to carry.
    expect(isSelfAssignee("Кирилл (я) ")).toBe(true);
    expect(isSelfAssignee("Игорь Витковский")).toBe(false);
    expect(isSelfAssignee("")).toBe(false);
    // A colleague whose name merely mentions the letter must not be caught.
    expect(isSelfAssignee("Яна Ярцева")).toBe(false);
  });

  it("matches exactly one of the names the tracker ships with", () => {
    expect(DEFAULT_ASSIGNEES.filter(isSelfAssignee)).toEqual(["Кирилл (я)"]);
  });
});

// «Каждый сдаёт сам» (миграция 0067). Ключ пишется ВСЕГДА — в пачке
// PostgREST пропущенный ключ становится NULL в not null колонке, и падает
// вся пачка синхронизации, а не одна задача.
describe("each_own", () => {
  const base = { id: "t1", title: "Книга", desc: "", assignee: "Аня", sectionId: "", priority: "med", term: "short", status: "in_progress", deadline: "2026-10-30", recur: "none", recurWeekday: "", recurMonthday: "", recurYearDay: "" } as unknown as Task;

  it("пишется всегда, по умолчанию false", () => {
    expect(taskToRow(base).each_own).toBe(false);
    expect(taskToRow({ ...base, eachOwn: true }).each_own).toBe(true);
  });

  it("читается обратно, у старых строк без колонки — false", () => {
    expect(taskFromRow({ ...taskToRow(base), each_own: true }).eachOwn).toBe(true);
    const old = { ...taskToRow(base) } as Record<string, unknown>;
    delete old.each_own;
    expect(taskFromRow(old as unknown as ReturnType<typeof taskToRow>).eachOwn).toBe(false);
  });
});
