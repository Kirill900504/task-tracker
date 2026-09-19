import { describe, it, expect } from "vitest";
import { crashNotice, fingerprintOf, shouldNotify, tooMany, NOTICE_WINDOW_MS } from "@/lib/crashReport";

describe("fingerprintOf", () => {
  it("склеивает одну и ту же поломку у разных людей", () => {
    const a = fingerprintOf("Cannot read properties of null", "at tu (https://tracker.app/_next/static/chunks/abc123.js:1:4242)");
    const b = fingerprintOf("Cannot read properties of null", "at tu (https://tracker.app/_next/static/chunks/abc123.js:1:9999)");
    expect(a).toBe(b);
  });

  it("различает разные поломки", () => {
    expect(fingerprintOf("Cannot read properties of null")).not.toBe(fingerprintOf("Maximum update depth exceeded"));
  });

  it("не тащит в отпечаток адреса и идентификаторы задач", () => {
    const print = fingerprintOf("сбой в задаче tmu8a554gkjlii на https://tracker.app/?id=42");
    expect(print).not.toContain("tmu8a554gkjlii");
    expect(print).not.toContain("tracker.app");
    expect(print).not.toContain("42");
  });

  it("переживает пустое сообщение", () => {
    expect(fingerprintOf("")).toContain("неизвестная ошибка");
  });
});

describe("shouldNotify", () => {
  const now = Date.parse("2026-09-19T18:00:00Z");

  it("о новой поломке говорит", () => {
    expect(shouldNotify(null, now)).toBe(true);
  });

  it("о той же самой в течение часа молчит", () => {
    expect(shouldNotify(new Date(now - 10 * 60 * 1000).toISOString(), now)).toBe(false);
  });

  it("через час говорит снова: значит не починено", () => {
    expect(shouldNotify(new Date(now - NOTICE_WINDOW_MS - 1000).toISOString(), now)).toBe(true);
  });

  it("на испорченную дату отвечает «говорить» — молчать опаснее", () => {
    expect(shouldNotify("не дата", now)).toBe(true);
  });
});

describe("tooMany", () => {
  it("пропускает первые строки и отсекает поток", () => {
    expect(tooMany(0)).toBe(false);
    expect(tooMany(4)).toBe(false);
    expect(tooMany(5)).toBe(true);
    expect(tooMany(900)).toBe(true);
  });
});

describe("crashNotice", () => {
  it("называет поломку, страницу и версию", () => {
    const text = crashNotice({
      message: "Minified React error #185\nвторая строка не нужна",
      url: "https://tracker.app/?tab=today",
      release: "abc1234",
    });
    expect(text).toContain("Minified React error #185");
    expect(text).not.toContain("вторая строка");
    expect(text).toContain("/?tab=today");
    expect(text).toContain("abc1234");
  });

  it("называет человека, если упало не у владельца", () => {
    expect(crashNotice({ message: "сбой", who: "igor@example.ru" })).toContain("igor@example.ru");
  });

  it("без страницы и версии остаётся связным текстом", () => {
    const text = crashNotice({ message: "сбой" });
    expect(text).toContain("Трекер сломался");
    expect(text).not.toContain("Страница:");
    expect(text).not.toContain("Версия:");
  });
});
