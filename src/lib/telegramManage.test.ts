import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "./telegramManage";

describe("fuzzyMatch", () => {
  it("matches when the title contains the query", () => {
    expect(fuzzyMatch("Позвонить Сергею по опту", "позвонить сергею")).toBe(true);
  });

  it("matches when the query contains the whole title (short exact titles)", () => {
    expect(fuzzyMatch("Опт", "согласовать опт с поставщиком")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("Встреча по сайту", "ВСТРЕЧА")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(fuzzyMatch("Согласовать прайс", "позвонить Сергею")).toBe(false);
  });

  it("never matches when either side is empty", () => {
    expect(fuzzyMatch("", "что угодно")).toBe(false);
    expect(fuzzyMatch("Что угодно", "")).toBe(false);
  });
});
