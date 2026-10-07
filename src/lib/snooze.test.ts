import { describe, it, expect } from "vitest";
import { isSnoozed, snoozeChoices } from "./snooze";

describe("отложить до", () => {
  it("отложена, пока день возвращения впереди; в сам день — уже нет", () => {
    expect(isSnoozed("2026-10-09", "2026-10-07")).toBe(true);
    expect(isSnoozed("2026-10-07", "2026-10-07")).toBe(false);
    expect(isSnoozed("", "2026-10-07")).toBe(false);
  });

  it("предлагает завтра, ближайший понедельник и неделю", () => {
    expect(snoozeChoices("2026-10-07").map((c) => c.value)).toEqual(["2026-10-08", "2026-10-12", "2026-10-14"]);
  });

  it("в воскресенье не повторяет понедельник дважды", () => {
    expect(snoozeChoices("2026-10-11").map((c) => c.value)).toEqual(["2026-10-12", "2026-10-18"]);
  });
});
