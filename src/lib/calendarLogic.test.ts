import { describe, it, expect } from "vitest";
import type { Meeting } from "@/types/tracker";
import { addDaysIso, getMonthGridDates, sortMeetingsForList } from "./calendarLogic";

describe("addDaysIso", () => {
  it("adds days using local calendar fields, correctly crossing a month boundary", () => {
    expect(addDaysIso("2026-08-30", 3)).toBe("2026-09-02");
  });
});

describe("getMonthGridDates", () => {
  it("returns 42 dates, Monday-first, starting before the 1st when needed", () => {
    // September 2026 starts on a Tuesday, so the grid should start on the
    // preceding Monday, 2026-08-31.
    const dates = getMonthGridDates(new Date(2026, 8, 15));
    expect(dates).toHaveLength(42);
    expect(dates[0].getDay()).toBe(1); // Monday
    expect(dates[0].getFullYear()).toBe(2026);
    expect(dates[0].getMonth()).toBe(7); // August
    expect(dates[0].getDate()).toBe(31);
  });

  it("includes the 1st of the requested month somewhere in the grid", () => {
    const dates = getMonthGridDates(new Date(2026, 8, 15));
    const hasFirst = dates.some((d) => d.getFullYear() === 2026 && d.getMonth() === 8 && d.getDate() === 1);
    expect(hasFirst).toBe(true);
  });
});

function baseMeeting(overrides: Partial<Meeting>): Meeting {
  return {
    id: "m1",
    date: "2026-09-02",
    time: "10:00",
    title: "test",
    participants: [],
    status: "planned",
    result: "",
    movedToDate: "",
    ...overrides,
  };
}

describe("sortMeetingsForList", () => {
  it("hides resolved meetings by default, shows them when showResolved is true", () => {
    const planned = baseMeeting({ id: "a", status: "planned" });
    const resolved = baseMeeting({ id: "b", status: "success" });
    expect(sortMeetingsForList([planned, resolved], false).map((m) => m.id)).toEqual(["a"]);
    expect(sortMeetingsForList([planned, resolved], true).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("sorts by date then time ascending", () => {
    const a = baseMeeting({ id: "a", date: "2026-09-02", time: "15:00" });
    const b = baseMeeting({ id: "b", date: "2026-09-01", time: "09:00" });
    const c = baseMeeting({ id: "c", date: "2026-09-02", time: "09:00" });
    expect(sortMeetingsForList([a, b, c], false).map((m) => m.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the input array", () => {
    const list = [baseMeeting({ id: "b", date: "2026-09-02" }), baseMeeting({ id: "a", date: "2026-09-01" })];
    const original = list.slice();
    sortMeetingsForList(list, false);
    expect(list).toEqual(original);
  });
});
