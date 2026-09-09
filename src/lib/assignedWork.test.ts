import { describe, expect, it } from "vitest";
import { byDeadline, canAnswer, isOverdueFor, workGroup, type WorkState } from "./assignedWork";

function item(over: Partial<WorkState> = {}): WorkState {
  return {
    role: "executor",
    acceptedAt: null,
    doneAt: null,
    declinedAt: null,
    deadline: "",
    approvalState: "open",
    ...over,
  };
}

const t = "2026-09-09T10:00:00Z";

describe("на что смотреть первым", () => {
  it("новая — пока на неё не ответили ничем", () => {
    expect(workGroup(item())).toBe("new");
  });

  it("принятая и отклонённая обе в работе: ответ дан, дело не закрыто", () => {
    expect(workGroup(item({ acceptedAt: t }))).toBe("work");
    expect(workGroup(item({ declinedAt: t }))).toBe("work");
  });

  it("отчитался — уже позади, даже если постановщик ещё не принял", () => {
    expect(workGroup(item({ doneAt: t }))).toBe("done");
  });

  it("принятая постановщиком закрыта в любом случае", () => {
    expect(workGroup(item({ approvalState: "accepted" }))).toBe("done");
  });
});

describe("просрочка", () => {
  it("считается только по несделанному", () => {
    expect(isOverdueFor(item({ deadline: "2026-09-01" }), "2026-09-09")).toBe(true);
    expect(isOverdueFor(item({ deadline: "2026-09-01", doneAt: t }), "2026-09-09")).toBe(false);
  });

  it("сегодняшний срок ещё не просрочен", () => {
    expect(isOverdueFor(item({ deadline: "2026-09-09" }), "2026-09-09")).toBe(false);
  });

  it("без срока просрочить нечего", () => {
    expect(isOverdueFor(item(), "2026-09-09")).toBe(false);
  });
});

describe("порядок", () => {
  it("ближайший срок первым, без срока — в конец", () => {
    const list = [{ deadline: "" }, { deadline: "2026-10-01" }, { deadline: "2026-09-15" }];
    expect([...list].sort(byDeadline).map((x) => x.deadline)).toEqual(["2026-09-15", "2026-10-01", ""]);
  });
});

describe("кому и когда показывать кнопки", () => {
  it("отвечает только исполнитель", () => {
    expect(canAnswer(item())).toBe(true);
    expect(canAnswer(item({ role: "coexecutor" }))).toBe(false);
    expect(canAnswer(item({ role: "watcher" }))).toBe(false);
  });

  it("после отчёта отвечать больше нечем", () => {
    expect(canAnswer(item({ doneAt: t }))).toBe(false);
  });

  it("после принятия работы — тоже", () => {
    expect(canAnswer(item({ approvalState: "accepted" }))).toBe(false);
  });

  it("но отказ не закрывает вопрос: передумать можно", () => {
    expect(canAnswer(item({ declinedAt: t }))).toBe(true);
  });
});
