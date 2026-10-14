import { describe, expect, it } from "vitest";
import { cleanSlots, isPoll, rankSlots } from "./meetingPoll";

const opts = [
  { date: "2026-10-16", time: "10:00" },
  { date: "2026-10-15", time: "15:00" },
  { date: "2026-10-17", time: "11:00" },
];

describe("опрос времени встречи", () => {
  it("больше голосов — выше, при равенстве — раньше", () => {
    expect(rankSlots(opts, [[0, 2], [2], [0, 1]])).toEqual([0, 2, 1]);
    expect(rankSlots(opts, [[2], [2], [0, 1]])).toEqual([2, 1, 0]);
    expect(rankSlots(opts, [[0], [1]])).toEqual([1, 0, 2]);
  });
  it("голос чистится от чужих номеров и повторов", () => {
    expect(cleanSlots([2, 2, 0, 7, -1, "1"], 3)).toEqual([0, 1, 2]);
    expect(cleanSlots("0", 3)).toEqual([]);
  });
  it("опрос — это предложенная встреча с двумя вариантами и больше", () => {
    expect(isPoll({ status: "proposed", slot_options: opts })).toBe(true);
    expect(isPoll({ status: "planned", slot_options: opts })).toBe(false);
    expect(isPoll({ status: "proposed", slotOptions: [opts[0]] })).toBe(false);
  });
});
