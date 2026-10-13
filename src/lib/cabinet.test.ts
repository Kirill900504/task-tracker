import { describe, expect, it } from "vitest";
import { cabinetDecision, isServiceEmail, serviceEmail } from "./cabinet";

describe("cabinetDecision", () => {
  it("never revives access the owner switched off", () => {
    expect(cabinetDecision({ id: "m", member_id: "u", status: "disabled" })).toEqual({ kind: "refused" });
    expect(cabinetDecision({ id: "m", member_id: null, status: "disabled" })).toEqual({ kind: "refused" });
  });

  it("uses the login that is already there", () => {
    expect(cabinetDecision({ id: "m", member_id: "u1", status: "active" })).toEqual({ kind: "ready", authId: "u1" });
  });

  it("creates one for a pending invitation, reusing its row", () => {
    expect(cabinetDecision({ id: "m", member_id: null, status: "invited" })).toEqual({ kind: "create", memberRowId: "m" });
  });

  it("creates one for a person who was never invited", () => {
    expect(cabinetDecision(null)).toEqual({ kind: "create", memberRowId: null });
  });
});

describe("service email", () => {
  it("is stable per person and recognised as not a real mailbox", () => {
    expect(serviceEmail("abc")).toBe(serviceEmail("abc"));
    expect(isServiceEmail(serviceEmail("abc"))).toBe(true);
    expect(isServiceEmail("ivanov@company.ru")).toBe(false);
    expect(isServiceEmail(null)).toBe(false);
  });
});
