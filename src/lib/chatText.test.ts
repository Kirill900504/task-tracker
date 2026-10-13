import { describe, expect, it } from "vitest";
import { insertAt, nearBottom, splitLinks } from "./chatText";

describe("insertAt", () => {
  it("puts the emoji where the caret is, not at the end", () => {
    expect(insertAt("привет мир", 6, 6, " 👋")).toEqual({ value: "привет 👋 мир", caret: 9 });
  });
  it("replaces a selection", () => {
    expect(insertAt("abc", 1, 2, "X")).toEqual({ value: "aXc", caret: 2 });
  });
  it("survives a caret past the end", () => {
    expect(insertAt("ab", 9, 9, "!")).toEqual({ value: "ab!", caret: 3 });
  });
});

describe("splitLinks", () => {
  it("leaves plain text alone", () => {
    expect(splitLinks("просто текст")).toEqual(["просто текст"]);
  });
  it("cuts trailing punctuation off a link", () => {
    expect(splitLinks("смотри https://x.ru/a.")).toEqual(["смотри ", { url: "https://x.ru/a", text: "https://x.ru/a" }, "."]);
  });
  it("makes www. clickable", () => {
    expect(splitLinks("www.rokas.ru")).toEqual([{ url: "https://www.rokas.ru", text: "www.rokas.ru" }]);
  });
});

describe("nearBottom", () => {
  it("counts almost-at-the-bottom as the bottom", () => {
    expect(nearBottom(560, 400, 1000)).toBe(true);
    expect(nearBottom(100, 400, 1000)).toBe(false);
  });
});
