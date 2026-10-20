import { describe, expect, it } from "vitest";
import { parseDue, parseMeetingRepeat, parseTaskRepeat, repeatLabel } from "@/lib/botWhen";

// Вторник, 20.10.2026, 13:00 по Москве — в полях UTC, как moscowNow().
const NOW = new Date("2026-10-20T13:00:00Z");

describe("когда напомнить", () => {
  it("«завтра в 9» и «завтра» — девять утра завтра", () => {
    expect(parseDue("напомни завтра в 9 про смету", NOW)?.at).toBe("2026-10-21T09:00:00+03:00");
    expect(parseDue("завтра про смету", NOW)?.at).toBe("2026-10-21T09:00:00+03:00");
  });
  it("«через 2 часа», «через 30 минут», «через полчаса», «через час»", () => {
    expect(parseDue("через 2 часа позвонить", NOW)?.at).toBe("2026-10-20T15:00:00+03:00");
    expect(parseDue("через 30 минут", NOW)?.at).toBe("2026-10-20T13:30:00+03:00");
    expect(parseDue("через полчаса", NOW)?.at).toBe("2026-10-20T13:30:00+03:00");
    expect(parseDue("через час", NOW)?.at).toBe("2026-10-20T14:00:00+03:00");
  });
  it("только час: сегодня, а прошедший — завтра", () => {
    expect(parseDue("в 15:30", NOW)?.at).toBe("2026-10-20T15:30:00+03:00");
    expect(parseDue("в 10:00", NOW)?.at).toBe("2026-10-21T10:00:00+03:00");
  });
  it("день недели", () => {
    expect(parseDue("в пятницу в 11:00", NOW)?.at).toBe("2026-10-23T11:00:00+03:00");
  });
  it("без времени — не угадываем", () => {
    expect(parseDue("про смету", NOW)).toBeNull();
  });
});

describe("повтор задачи", () => {
  it("каждый понедельник / по средам и пятницам", () => {
    expect(parseTaskRepeat("каждый понедельник сдавать отчёт")).toEqual({ recur: "weekly", recur_weekday: 1, recur_weekdays: [1] });
    expect(parseTaskRepeat("по средам и пятницам звонить на склад")).toEqual({ recur: "weekly", recur_weekday: 3, recur_weekdays: [3, 5] });
  });
  it("по будням, каждый день, каждое 5 число", () => {
    expect(parseTaskRepeat("по будням проверять почту")?.recur_weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(parseTaskRepeat("каждый день")).toEqual({ recur: "daily" });
    expect(parseTaskRepeat("каждое 5 число платить аренду")).toEqual({ recur: "monthly", recur_monthday: 5 });
  });
  it("разовое — null", () => {
    expect(parseTaskRepeat("в понедельник сдать отчёт")).toBeNull();
  });
  it("подпись", () => {
    expect(repeatLabel({ recur: "weekly", recur_weekdays: [1, 2, 3, 4, 5] })).toBe("по будням");
    expect(repeatLabel({ recur: "weekly", recur_weekdays: [3, 5] })).toBe("по ср, пт");
  });
});

describe("повтор встречи", () => {
  it("недели, две недели, месяц", () => {
    expect(parseMeetingRepeat("планёрка по вторникам в 10")).toBe("weekly");
    expect(parseMeetingRepeat("раз в две недели созвон")).toBe("biweekly");
    expect(parseMeetingRepeat("каждый месяц отчёт")).toBe("monthly");
    expect(parseMeetingRepeat("во вторник планёрка")).toBeNull();
  });
});
