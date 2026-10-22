import { describe, it, expect } from "vitest";
import { isSnoozed, snoozeChoices, snoozeDay, snoozeMinDate, snoozePastDeadline } from "./snooze";

describe("отложить до", () => {
  it("отложена, пока день возвращения впереди; в сам день — уже нет", () => {
    expect(isSnoozed("2026-10-09", "2026-10-07")).toBe(true);
    expect(isSnoozed("2026-10-07", "2026-10-07")).toBe(false);
    expect(isSnoozed("", "2026-10-07")).toBe(false);
  });

  it("предлагает завтра и через неделю — рабочими днями", () => {
    expect(snoozeChoices("2026-10-07").map((c) => c.value)).toEqual(["2026-10-08", "2026-10-14"]);
    // В пятницу «завтра» — это понедельник.
    expect(snoozeChoices("2026-10-09").map((c) => c.value)).toEqual(["2026-10-12", "2026-10-16"]);
  });

  it("подпись называет день недели и число", () => {
    expect(snoozeDay("2026-10-22")).toBe("чт 22.10");
    expect(snoozeChoices("2026-10-07")[0].label).toBe("Завтра, чт 08.10");
  });

  it("в календаре раньше завтрашнего дня не выбрать", () => {
    expect(snoozeMinDate("2026-10-31")).toBe("2026-11-01");
  });

  it("предупреждает, когда задача вернётся уже просроченной", () => {
    expect(snoozePastDeadline("2026-10-21", "2026-10-16")).toBe(true);
    expect(snoozePastDeadline("2026-10-16", "2026-10-16")).toBe(false);
    expect(snoozePastDeadline("2026-10-21", "")).toBe(false);
    expect(snoozePastDeadline("", "2026-10-16")).toBe(false);
  });
});
