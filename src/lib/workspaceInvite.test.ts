import { describe, expect, it } from "vitest";
import { emailProblem, inviteExpired, joinLink, passwordProblem, randomInviteCode } from "./workspaceInvite";

describe("the invite code", () => {
  it("is long enough that guessing is not a strategy", () => {
    expect(randomInviteCode()).toHaveLength(24);
  });

  it("avoids the characters people confuse when reading a link aloud", () => {
    for (let i = 0; i < 50; i++) expect(randomInviteCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, randomInviteCode));
    expect(seen.size).toBe(200);
  });
});

describe("the link handed over", () => {
  it("carries the code", () => {
    expect(joinLink("https://tracker.example.com", "ABC")).toBe("https://tracker.example.com/join?code=ABC");
  });

  it("survives an origin with a trailing slash", () => {
    expect(joinLink("https://tracker.example.com/", "ABC")).toBe("https://tracker.example.com/join?code=ABC");
  });
});

describe("expiry", () => {
  const now = new Date("2026-09-09T12:00:00Z");

  it("is open before the deadline and shut after it", () => {
    expect(inviteExpired("2026-09-10T12:00:00Z", now)).toBe(false);
    expect(inviteExpired("2026-09-09T11:59:59Z", now)).toBe(true);
  });

  it("treats a timestamp it cannot read as expired", () => {
    expect(inviteExpired("не дата", now)).toBe(true);
  });
});

describe("what the person types", () => {
  it("catches an empty or malformed address", () => {
    expect(emailProblem("")).toBe("Укажите почту");
    expect(emailProblem("петров")).toBe("Похоже, в адресе опечатка");
    expect(emailProblem(" petrov@example.com ")).toBe("");
  });

  it("refuses a password that is too short or all digits", () => {
    expect(passwordProblem("1234")).toContain("8 символов");
    expect(passwordProblem("12345678")).toContain("цифр");
    expect(passwordProblem("кассы2026")).toBe("");
  });
});
