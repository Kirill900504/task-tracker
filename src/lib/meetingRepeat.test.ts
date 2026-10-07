import { describe, it, expect } from "vitest";
import { nextOccurrence, spawnsNext } from "./meetingRepeat";

describe("регулярные встречи", () => {
  it("следующая — через неделю, две или месяц", () => {
    expect(nextOccurrence("2026-10-05", "weekly", "2026-10-05")).toBe("2026-10-12");
    expect(nextOccurrence("2026-10-05", "biweekly", "2026-10-05")).toBe("2026-10-19");
    expect(nextOccurrence("2026-10-05", "monthly", "2026-10-05")).toBe("2026-11-05");
    expect(nextOccurrence("2026-10-05", "none", "2026-10-05")).toBeNull();
  });

  it("31-е через месяц — последнее число короткого месяца, а не начало следующего", () => {
    expect(nextOccurrence("2027-01-31", "monthly", "2027-01-31")).toBe("2027-02-28");
  });

  it("пропущенные повторения задним числом не заводятся", () => {
    expect(nextOccurrence("2026-09-07", "weekly", "2026-10-07")).toBe("2026-10-12");
  });

  it("цепочку продолжает только состоявшаяся или назначенная встреча, один раз", () => {
    const base = { recur: "weekly", status: "planned", recur_next_id: null, date: "2026-10-05" };
    expect(spawnsNext(base, "2026-10-05")).toBe(true);
    expect(spawnsNext(base, "2026-10-04")).toBe(false); // её день ещё не пришёл
    expect(spawnsNext({ ...base, recur_next_id: "x" }, "2026-10-05")).toBe(false);
    expect(spawnsNext({ ...base, status: "no_result", moved_to_date: "2026-10-06" }, "2026-10-05")).toBe(false);
    expect(spawnsNext({ ...base, status: "proposed" }, "2026-10-05")).toBe(false);
    expect(spawnsNext({ ...base, status: "success" }, "2026-10-06")).toBe(true);
    expect(spawnsNext({ ...base, recur: "none" }, "2026-10-05")).toBe(false);
  });
});
