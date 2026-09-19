import { describe, it, expect } from "vitest";
import { issueBody, issueTitle } from "@/lib/githubIssue";

describe("issueTitle", () => {
  it("берёт первую строку ошибки", () => {
    expect(issueTitle("Cannot read properties of null\nat tu (chunk.js)")).toBe("Поломка у людей: Cannot read properties of null");
  });

  it("режет длинное, чтобы заголовок оставался заголовком", () => {
    const title = issueTitle("ы".repeat(300));
    expect(title.length).toBeLessThan(150);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("issueBody", () => {
  it("несёт всё, с чем можно начать чинить", () => {
    const body = issueBody({
      message: "Minified React error #185",
      stack: "at tu (chunk.js:1:1)",
      url: "https://tracker.app/?tab=today",
      release: "abc1234",
      who: "igor@example.ru",
      fingerprint: "react error @ chunk",
    });
    expect(body).toContain("Minified React error #185");
    expect(body).toContain("https://tracker.app/?tab=today");
    expect(body).toContain("abc1234");
    expect(body).toContain("igor@example.ru");
    expect(body).toContain("react error @ chunk");
    expect(body).toContain("at tu (chunk.js:1:1)");
  });

  it("без стека и без страницы остаётся связным", () => {
    const body = issueBody({ message: "сбой", fingerprint: "сбой" });
    expect(body).toContain("сбой");
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("**Страница:**");
  });
});
