import { describe, it, expect } from "vitest";
import { busyStarts, defaultMeetingStart, endsAt, minutesOf, normalizeDuration, overlaps, slotOf, startsInPast, timeOf, warnBefore } from "./meetingTime";

// Занятость человека считается здесь, и ошибка тут стоит дороже обычной:
// слот, показанный свободным, — это два приглашения на одно время, а
// показанный занятым без причины — день, в который никого не собрать.

describe("время встречи", () => {
  it("читает часы и минуты, а мусор отвергает", () => {
    expect(minutesOf("09:30")).toBe(570);
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("")).toBeNull();
    expect(minutesOf("завтра")).toBeNull();
    expect(minutesOf("25:00")).toBeNull();
    expect(minutesOf("10:75")).toBeNull();
  });

  it("складывается обратно", () => {
    expect(timeOf(570)).toBe("09:30");
    expect(timeOf(0)).toBe("00:00");
  });

  it("знает только две длительности и не верит чужим числам", () => {
    expect(normalizeDuration(60)).toBe(60);
    expect(normalizeDuration(30)).toBe(30);
    expect(normalizeDuration(undefined)).toBe(30);
    expect(normalizeDuration(45)).toBe(30);
    expect(normalizeDuration("60")).toBe(60);
  });

  it("считает, когда встреча кончится", () => {
    expect(endsAt("12:00", 30)).toBe("12:30");
    expect(endsAt("12:00", 60)).toBe("13:00");
    expect(endsAt("", 60)).toBe("");
  });
});

describe("пересечения", () => {
  const at = (time: string, min: number) => slotOf(time, min)!;

  it("час поверх получаса — занято", () => {
    expect(overlaps(at("12:00", 60), at("12:30", 30))).toBe(true);
  });

  it("подряд — не занято: 12:00–12:30 и 12:30 идут друг за другом", () => {
    expect(overlaps(at("12:00", 30), at("12:30", 30))).toBe(false);
  });

  it("врозь — не занято", () => {
    expect(overlaps(at("09:00", 60), at("14:00", 30))).toBe(false);
  });
});

describe("какие получасовки гасить", () => {
  it("получасовая встреча закрывает одну", () => {
    expect(busyStarts([slotOf("12:00", 30)!])).toEqual([720]);
  });

  it("часовая — две подряд, и это главное отличие часа от получаса", () => {
    expect(busyStarts([slotOf("12:00", 60)!])).toEqual([720, 750]);
  });

  it("несколько встреч не дублируют один и тот же слот", () => {
    const slots = [slotOf("12:00", 60)!, slotOf("12:30", 30)!];
    expect(busyStarts(slots)).toEqual([720, 750]);
  });
});

describe("за сколько предупреждать", () => {
  it("у часа — за десять минут, у получаса — за пять", () => {
    // Доля одна и та же, а пять минут до конца часовой встречи никого не
    // успевают сдвинуть с места.
    expect(warnBefore(60)).toBe(10);
    expect(warnBefore(30)).toBe(5);
    expect(warnBefore(undefined)).toBe(5);
  });
});

// В 17:26 форма предлагала «сегодня, 10:00», и встреча молча создавалась в
// прошлом (QA 06.10.2026).
describe("defaultMeetingStart", () => {
  const slots = ["09:00", "09:30", "10:00", "17:30", "18:00"];
  const at = (h: number, m: number) => new Date(2026, 9, 6, h, m);

  it("берёт первый ещё не начавшийся слот сегодня", () => {
    expect(defaultMeetingStart("2026-10-06", slots, at(17, 26))).toEqual({ date: "2026-10-06", time: "17:30" });
    expect(defaultMeetingStart("", slots, at(8, 0))).toEqual({ date: "2026-10-06", time: "09:00" });
  });

  it("слот, который начинается ровно сейчас, уже не предлагает", () => {
    expect(defaultMeetingStart("2026-10-06", slots, at(17, 30))).toEqual({ date: "2026-10-06", time: "18:00" });
  });

  it("когда на сегодня слотов не осталось — завтра утром", () => {
    expect(defaultMeetingStart("2026-10-06", slots, at(18, 5))).toEqual({ date: "2026-10-07", time: "10:00" });
  });

  it("на другой день — 10:00, как и было", () => {
    expect(defaultMeetingStart("2026-10-09", slots, at(17, 26))).toEqual({ date: "2026-10-09", time: "10:00" });
  });
});

describe("startsInPast", () => {
  const now = new Date(2026, 9, 6, 17, 26);
  it("сегодняшнее утро — в прошлом, вечер — нет", () => {
    expect(startsInPast("2026-10-06", "10:00", now)).toBe(true);
    expect(startsInPast("2026-10-06", "17:30", now)).toBe(false);
  });
  it("вчера — в прошлом, завтра — нет, без даты — не решаем", () => {
    expect(startsInPast("2026-10-05", "18:00", now)).toBe(true);
    expect(startsInPast("2026-10-07", "09:00", now)).toBe(false);
    expect(startsInPast("", "09:00", now)).toBe(false);
  });
});