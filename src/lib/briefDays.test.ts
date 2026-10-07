import { describe, it, expect } from "vitest";
import { briefLooksUntil, isBriefDay } from "./briefDays";

// Сводка — по понедельникам и средам (07.10.2026), и смотрит вперёд до
// следующей: иначе срок во вторник или в пятницу не попал бы ни в одну.
describe("дни утренней сводки", () => {
  const at = (iso: string) => new Date(iso + "T09:00:00Z");

  it("выходит в понедельник и среду, в остальные дни — нет", () => {
    expect(isBriefDay(at("2026-10-05"))).toBe(true); // пн
    expect(isBriefDay(at("2026-10-07"))).toBe(true); // ср
    for (const d of ["2026-10-06", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]) expect(isBriefDay(at(d))).toBe(false);
  });

  it("в понедельник предупреждает о сроках до среды, в среду — до понедельника", () => {
    expect(briefLooksUntil(at("2026-10-05"))).toBe("2026-10-07");
    expect(briefLooksUntil(at("2026-10-07"))).toBe("2026-10-12");
  });

  it("в другие дни вперёд не смотрит", () => {
    expect(briefLooksUntil(at("2026-10-06"))).toBe("");
  });
});
