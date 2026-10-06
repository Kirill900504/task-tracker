import { describe, expect, it } from "vitest";
import { ACCEPT_AFTER_H, FRESH_FOR_H, isDue } from "./waitingNudges";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe("isDue", () => {
  it("рано — молчит", () => {
    expect(isDue(hoursAgo(ACCEPT_AFTER_H - 1), NOW, ACCEPT_AFTER_H)).toBe(false);
  });

  it("порог прошёл — пора", () => {
    expect(isDue(hoursAgo(ACCEPT_AFTER_H + 0.5), NOW, ACCEPT_AFTER_H)).toBe(true);
  });

  it("давнее не будит никого в день выкладки", () => {
    expect(isDue(hoursAgo(FRESH_FOR_H + 1), NOW, ACCEPT_AFTER_H)).toBe(false);
  });

  it("без даты — молчит", () => {
    expect(isDue(null, NOW, ACCEPT_AFTER_H)).toBe(false);
    expect(isDue("", NOW, ACCEPT_AFTER_H)).toBe(false);
  });
});
