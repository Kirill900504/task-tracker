import { describe, expect, it } from "vitest";
import { openTaskChoices, openVoteChoices, voteVerdict } from "./answerRules";

describe("ответ на встречу даётся один раз", () => {
  it("пока не ответил — доступны все три", () => {
    expect(openVoteChoices(null)).toEqual(["yes", "late", "no"]);
    expect(openVoteChoices({ response: "none" })).toEqual(["yes", "late", "no"]);
  });

  it("после «буду» остаётся только «опоздаю»", () => {
    const v = { response: "yes" as const, late: false, round: 1 };
    expect(openVoteChoices(v)).toEqual(["late"]);
    expect(voteVerdict(v, "late")).toBe("ok");
    expect(voteVerdict(v, "no")).toBe("locked");
  });

  it("после «опоздаю» и «не смогу» не остаётся ничего", () => {
    const late = { response: "yes" as const, late: true, round: 1 };
    const no = { response: "no" as const, round: 1 };
    expect(openVoteChoices(late)).toEqual([]);
    expect(openVoteChoices(no)).toEqual([]);
    // Ровно то, что прислал Кирилл: «буду → опоздаю → буду → не смогу».
    expect(voteVerdict(late, "yes")).toBe("locked");
    expect(voteVerdict(late, "no")).toBe("locked");
    expect(voteVerdict(no, "yes")).toBe("locked");
    expect(voteVerdict(no, "late")).toBe("locked");
  });

  it("тот же ответ ещё раз — не ошибка и не событие", () => {
    expect(voteVerdict({ response: "no", round: 1 }, "no")).toBe("same");
    expect(voteVerdict({ response: "yes", late: true, round: 1 }, "late")).toBe("same");
  });

  it("перенос встречи открывает выбор заново", () => {
    const no = { response: "no" as const, round: 1 };
    expect(openVoteChoices(no, 2)).toEqual(["yes", "late", "no"]);
    expect(voteVerdict(no, "yes", 2)).toBe("ok");
    expect(voteVerdict(no, "no", 2)).toBe("ok");
  });
});

describe("ответ на задачу даётся один раз", () => {
  it("новая задача — всё доступно", () => {
    expect(openTaskChoices({})).toEqual({ accept: true, done: true, decline: true, move: true });
  });

  it("принял — «Принял» гаснет, остальное на месте", () => {
    expect(openTaskChoices({ acceptedAt: "x" })).toEqual({ accept: false, done: true, decline: true, move: true });
  });

  it("отказ окончателен: «Сделал» после «Не могу» не даётся", () => {
    expect(openTaskChoices({ declinedAt: "x" })).toEqual({ accept: false, done: false, decline: false, move: false });
  });

  it("отчёт окончателен", () => {
    expect(openTaskChoices({ acceptedAt: "x", doneAt: "y" })).toEqual({ accept: false, done: false, decline: false, move: false });
  });

  it("просьба о переносе ждёт решения — второй раз не просят", () => {
    expect(openTaskChoices({ reschedulePending: true }).move).toBe(false);
    expect(openTaskChoices({ reschedulePending: true }).done).toBe(true);
  });
});
