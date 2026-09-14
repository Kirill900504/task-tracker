import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { botUsername, inviteChannel, inviteLink, randomCode } from "./botInvite";
import { forgetMaxSettings } from "./botSettings";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  forgetMaxSettings();
});

describe("inviteChannel", () => {
  it("only ever answers with a messenger the tracker actually supports", () => {
    expect(inviteChannel("max")).toBe("max");
    expect(inviteChannel("telegram")).toBe("telegram");
    // Anything else falls back to Telegram rather than trusting the body of
    // a request: a bad value must not become a channel name in the database.
    expect(inviteChannel(undefined)).toBe("telegram");
    expect(inviteChannel("MAX")).toBe("telegram");
    expect(inviteChannel({ channel: "max" })).toBe("telegram");
  });
});

describe("inviteLink", () => {
  // MAX's name is read through botSettings, which prefers the environment
  // and only then asks the database — so setting MAX_BOT_TOKEN here is what
  // keeps these tests away from a database they do not have.
  beforeEach(() => {
    process.env.MAX_BOT_TOKEN = "test-token";
    forgetMaxSettings();
  });

  it("builds the link each messenger expects", async () => {
    process.env.TELEGRAM_BOT_USERNAME = "rokas_bot";
    process.env.MAX_BOT_USERNAME = "rokas_max_bot";
    expect(await inviteLink("telegram", "AB23CD45")).toBe("https://t.me/rokas_bot?start=AB23CD45");
    expect(await inviteLink("max", "AB23CD45")).toBe("https://max.ru/rokas_max_bot?start=AB23CD45");
  });

  it("returns nothing at all when that bot does not exist yet", async () => {
    delete process.env.MAX_BOT_TOKEN;
    delete process.env.MAX_BOT_USERNAME;
    delete process.env.NEXT_PUBLIC_MAX_BOT_USERNAME;
    forgetMaxSettings();
    // No token anywhere — neither in the environment nor (here) in a
    // database — means there is no bot, and an invite link would otherwise
    // point at max.ru/undefined.
    expect(await botUsername("max")).toBe("");
    expect(await inviteLink("max", "AB23CD45")).toBe("");
  });

  it("accepts the public form of the MAX bot name, so one variable configures both sides", async () => {
    delete process.env.MAX_BOT_USERNAME;
    process.env.NEXT_PUBLIC_MAX_BOT_USERNAME = "rokas_max_bot";
    expect(await inviteLink("max", "XY99ZZ88")).toBe("https://max.ru/rokas_max_bot?start=XY99ZZ88");
  });
});

describe("randomCode", () => {
  it("avoids the characters that get misread when a code is retyped", () => {
    for (let i = 0; i < 200; i++) {
      const code = randomCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    }
  });
});
