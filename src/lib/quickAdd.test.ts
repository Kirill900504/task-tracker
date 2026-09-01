import { describe, it, expect } from "vitest";
import { isoDate, addDays, nextWeekdayMap, sanitizeAgainstKnown } from "./quickAdd";

describe("isoDate / addDays", () => {
  it("formats using local calendar fields (not UTC)", () => {
    const d = new Date(2026, 8, 2); // 2026-09-02, local time, no UTC conversion
    expect(isoDate(d)).toBe("2026-09-02");
  });

  it("adds days without rolling over incorrectly at month boundaries", () => {
    const d = new Date(2026, 8, 29); // 2026-09-29
    expect(isoDate(addDays(d, 3))).toBe("2026-10-02");
  });
});

describe("nextWeekdayMap", () => {
  // Regression test: GigaChat's free-tier model got "in Friday" wrong even
  // with a full 14-day calendar in the prompt (computed 2026-09-08, a
  // Tuesday, when the correct next Friday from Wed 2026-09-02 was
  // 2026-09-04). Handing over an explicit weekday->date map fixed it in
  // manual testing — this test locks in that the map itself is correct.
  it("maps each weekday name to its correct next occurrence, from a Wednesday", () => {
    const now = new Date(2026, 8, 2); // Wednesday 2026-09-02
    const map = nextWeekdayMap(now);
    const lines = map.split("\n");
    const asObj = Object.fromEntries(lines.map((l) => l.split(" → ")));

    expect(asObj["среда"]).toBe("2026-09-02"); // today
    expect(asObj["четверг"]).toBe("2026-09-03"); // tomorrow
    expect(asObj["пятница"]).toBe("2026-09-04"); // the bug case
    expect(asObj["суббота"]).toBe("2026-09-05");
    expect(asObj["воскресенье"]).toBe("2026-09-06");
    expect(asObj["понедельник"]).toBe("2026-09-07");
    expect(asObj["вторник"]).toBe("2026-09-08");
  });

  it("never maps a weekday to a date more than 6 days out", () => {
    const now = new Date(2026, 8, 2);
    const map = nextWeekdayMap(now);
    for (const line of map.split("\n")) {
      const [, iso] = line.split(" → ");
      const [y, m, d] = iso.split("-").map(Number);
      const local = new Date(y, m - 1, d); // parse as local, same anchor as `now`
      const diffDays = (local.getTime() - now.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThanOrEqual(0);
      expect(diffDays).toBeLessThanOrEqual(6);
    }
  });
});

describe("sanitizeAgainstKnown", () => {
  const known = ["Кирилл (я)", "Юрий Черкашин"];

  it("clears an assignee that isn't an exact match in the known list", () => {
    const input: Record<string, unknown> = { assignee: "Иван" };
    sanitizeAgainstKnown(input, known);
    expect(input.assignee).toBe("");
  });

  it("keeps an assignee that exactly matches the known list", () => {
    const input: Record<string, unknown> = { assignee: "Юрий Черкашин" };
    sanitizeAgainstKnown(input, known);
    expect(input.assignee).toBe("Юрий Черкашин");
  });

  it("filters out participants not in the known list, keeps the rest", () => {
    const input: Record<string, unknown> = { participants: ["Кирилл (я)", "Придуманное Имя"] };
    sanitizeAgainstKnown(input, known);
    expect(input.participants).toEqual(["Кирилл (я)"]);
  });
});
