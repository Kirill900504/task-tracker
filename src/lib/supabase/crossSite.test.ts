import { describe, expect, it } from "vitest";
import { crossSiteWrite } from "./middleware";
import { AUTH_COOKIE_OPTIONS } from "./cookieOptions";

// With the sign-in cookie SameSite=None (the MAX mini-app lives in a
// cross-site frame), this check is the one thing stopping another site from
// posting to /api as the person. So it is tested on its own.
describe("crossSiteWrite", () => {
  const host = "task-tracker-beta-ebon.vercel.app";

  it("refuses a write sent by another site", () => {
    expect(crossSiteWrite("POST", "https://evil.example", host)).toBe(true);
    expect(crossSiteWrite("DELETE", "https://web.max.ru", host)).toBe(true);
  });

  it("refuses an opaque origin — a sandboxed frame sends «null»", () => {
    expect(crossSiteWrite("POST", "null", host)).toBe(true);
  });

  it("lets the tracker's own pages through, framed or not", () => {
    expect(crossSiteWrite("POST", `https://${host}`, host)).toBe(false);
  });

  it("lets servers through: messenger webhooks and the cron send no Origin", () => {
    expect(crossSiteWrite("POST", null, host)).toBe(false);
  });

  it("never blocks reads", () => {
    expect(crossSiteWrite("GET", "https://evil.example", host)).toBe(false);
  });
});

describe("AUTH_COOKIE_OPTIONS", () => {
  it("is SameSite=None and therefore Secure — a browser drops None without it", () => {
    expect(AUTH_COOKIE_OPTIONS).toEqual({ sameSite: "none", secure: true });
  });
});
