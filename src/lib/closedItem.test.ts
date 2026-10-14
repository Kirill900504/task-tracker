import { describe, expect, it } from "vitest";
import { closedReply, meetingRowClosed, taskRowClosed } from "./closedItem";
import { isClosed } from "./taskDisplay";

// Одно правило в трёх средах (браузер, бот, база). Здесь сверяются первые
// две: бот обязан считать закрытым ровно то, что карточка показывает
// только для чтения.
describe("закрытое событие", () => {
  const cases = [
    { status: "done", recur: "none", approval: "open", closed: true },
    { status: "in_progress", recur: "none", approval: "accepted", closed: true },
    // Принятая повторяющаяся задача живёт дальше — следующий срок.
    { status: "in_progress", recur: "weekly", approval: "accepted", closed: false },
    { status: "in_progress", recur: "none", approval: "awaiting_review", closed: false },
    { status: "todo", recur: "none", approval: "returned", closed: false },
  ] as const;

  for (const c of cases) {
    it(`задача ${c.status}/${c.recur}/${c.approval} — ${c.closed ? "закрыта" : "открыта"}`, () => {
      expect(taskRowClosed({ status: c.status, recur: c.recur, approval_state: c.approval })).toBe(c.closed);
      expect(isClosed({ status: c.status, recur: c.recur, approvalState: c.approval } as Parameters<typeof isClosed>[0])).toBe(c.closed);
    });
  }

  it("встреча закрыта, когда у неё есть исход", () => {
    expect(meetingRowClosed({ status: "success" })).toBe(true);
    expect(meetingRowClosed({ status: "no_result" })).toBe(true);
    expect(meetingRowClosed({ status: "planned" })).toBe(false);
    expect(meetingRowClosed({ status: "proposed" })).toBe(false);
  });

  it("бот говорит, что закрыто и кто может открыть", () => {
    expect(closedReply("task", "Смета")).toContain("«Смета» уже закрыта");
    expect(closedReply("task", "Смета")).toContain("постановщик");
    expect(closedReply("meeting", "")).toContain("в план");
  });
});
