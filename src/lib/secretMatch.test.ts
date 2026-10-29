import { describe, expect, it } from "vitest";
import { bearerMatches, secretMatches } from "./secretMatch";

describe("secretMatches", () => {
  it("accepts the exact secret", () => {
    expect(secretMatches("abc123", "abc123")).toBe(true);
  });

  it("refuses a wrong or partial secret", () => {
    expect(secretMatches("abc124", "abc123")).toBe(false);
    expect(secretMatches("abc", "abc123")).toBe(false);
  });

  // The bug this exists for: an unset variable made `undefined !== undefined`
  // false, and a request without the header walked straight in.
  it("never matches when the expected secret is not configured", () => {
    expect(secretMatches(undefined, undefined)).toBe(false);
    expect(secretMatches(null, "")).toBe(false);
    expect(secretMatches("", "")).toBe(false);
  });
});

describe("bearerMatches", () => {
  it("accepts the right bearer header", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
  });

  // The backup cron compared against `Bearer ${undefined}` — a string
  // anybody can send.
  it("refuses «Bearer undefined» when the secret is unset", () => {
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
  });

  it("refuses a missing or malformed header", () => {
    expect(bearerMatches(null, "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
  });
});
