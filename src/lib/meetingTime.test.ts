import { describe, it, expect } from "vitest";
import { busyStarts, endsAt, minutesOf, normalizeDuration, overlaps, slotOf, timeOf, warnBefore } from "./meetingTime";

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
