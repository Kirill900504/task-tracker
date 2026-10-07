import { describe, it, expect } from "vitest";
import { awayPhrase, awayUntilChoices, isAwayOn, parseAwayDate } from "./away";

describe("отсутствия", () => {
  it("день возвращения — последний день отсутствия", () => {
    expect(isAwayOn("2026-10-15", "2026-10-15")).toBe(true);
    expect(isAwayOn("2026-10-15", "2026-10-16")).toBe(false);
    expect(isAwayOn("", "2026-10-01")).toBe(false);
  });

  it("говорит словами, где человек", () => {
    expect(awayPhrase("vacation", "2026-10-15")).toBe("в отпуске до 15.10");
    expect(awayPhrase(null, "2026-10-15")).toBe("отсутствует до 15.10");
  });

  it("неделя — это семь дней, считая сегодняшний", () => {
    expect(awayUntilChoices("2026-10-07").map((c) => c.value)).toEqual(["2026-10-07", "2026-10-08", "2026-10-13", "2026-10-20"]);
  });

  it("понимает «15.10» и ставит ближайший год впереди", () => {
    expect(parseAwayDate("15.10", "2026-10-07")).toBe("2026-10-15");
    expect(parseAwayDate("10.01", "2026-12-20")).toBe("2027-01-10");
    expect(parseAwayDate("31.02", "2026-10-07")).toBeNull();
    expect(parseAwayDate("завтра", "2026-10-07")).toBeNull();
  });
});
