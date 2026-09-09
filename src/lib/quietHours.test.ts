import { describe, expect, it } from "vitest";
import { isQuietHour, moscowHour } from "./quietHours";

// Метки в UTC; Москва — на три часа впереди.
const at = (utcHour: number) => new Date(Date.UTC(2026, 8, 9, utcHour, 0, 0));

describe("московский час", () => {
  it("считается сдвигом на три часа", () => {
    expect(moscowHour(at(9))).toBe(12);
    expect(moscowHour(at(22))).toBe(1); // за полночь
  });
});

describe("ночная тишина", () => {
  it("молчит с десяти вечера", () => {
    expect(isQuietHour(at(19))).toBe(true); // 22:00 МСК
    expect(isQuietHour(at(23))).toBe(true); // 02:00 МСК
    expect(isQuietHour(at(4))).toBe(true); // 07:00 МСК
  });

  it("и снова говорит с восьми утра", () => {
    expect(isQuietHour(at(5))).toBe(false); // 08:00 МСК
    expect(isQuietHour(at(12))).toBe(false); // 15:00 МСК
    expect(isQuietHour(at(18))).toBe(false); // 21:00 МСК
  });
});
