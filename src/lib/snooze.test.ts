import { describe, it, expect } from "vitest";
import { isSnoozed, snoozeChoices, snoozeDay, snoozePastDeadline } from "./snooze";

describe("отложить до", () => {
  it("отложена, пока день возвращения впереди; в сам день — уже нет", () => {
    expect(isSnoozed("2026-10-09", "2026-10-07")).toBe(true);
    expect(isSnoozed("2026-10-07", "2026-10-07")).toBe(false);
    expect(isSnoozed("", "2026-10-07")).toBe(false);
  });

  it("предлагает завтра, ближайший понедельник, неделю и две", () => {
    expect(snoozeChoices("2026-10-07").map((c) => c.value)).toEqual(["2026-10-08", "2026-10-12", "2026-10-14", "2026-10-21"]);
  });

  it("в воскресенье не повторяет понедельник дважды, а неделя — тоже рабочим днём", () => {
    expect(snoozeChoices("2026-10-11").map((c) => c.value)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
  });

  it("в пятницу «завтра» — это понедельник", () => {
    expect(snoozeChoices("2026-10-09").map((c) => c.value)).toEqual(["2026-10-12", "2026-10-16", "2026-10-23"]);
  });

  it("подпись называет день недели и число", () => {
    expect(snoozeDay("2026-10-22")).toBe("чт 22.10");
    expect(snoozeChoices("2026-10-07")[0].label).toBe("Завтра, чт 08.10");
  });

  it("«к сроку» — в порядке дней, и только если срок дальше завтрашнего", () => {
    const withDeadline = snoozeChoices("2026-10-07", "2026-10-16");
    expect(withDeadline.map((c) => c.value)).toEqual(["2026-10-08", "2026-10-12", "2026-10-14", "2026-10-16", "2026-10-21"]);
    expect(withDeadline[3].label).toBe("К сроку, пт 16.10");
    expect(snoozeChoices("2026-10-07", "2026-10-08").some((c) => c.label.startsWith("К сроку"))).toBe(false);
    expect(snoozeChoices("2026-10-07", "2026-10-01").some((c) => c.label.startsWith("К сроку"))).toBe(false);
  });

  it("срок, совпавший с другим вариантом, не повторяется", () => {
    expect(snoozeChoices("2026-10-07", "2026-10-14").map((c) => c.value)).toEqual(["2026-10-08", "2026-10-12", "2026-10-14", "2026-10-21"]);
  });

  it("предупреждает, когда задача вернётся уже просроченной", () => {
    expect(snoozePastDeadline("2026-10-21", "2026-10-16")).toBe(true);
    expect(snoozePastDeadline("2026-10-16", "2026-10-16")).toBe(false);
    expect(snoozePastDeadline("2026-10-21", "")).toBe(false);
    expect(snoozePastDeadline("", "2026-10-16")).toBe(false);
  });
});
