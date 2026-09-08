import { describe, it, expect, afterEach } from "vitest";
import { botUsername, inviteChannel, inviteLink, randomCode } from "./botInvite";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
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
  it("builds the link each messenger expects", () => {
    process.env.TELEGRAM_BOT_USERNAME = "rokas_bot";
    process.env.MAX_BOT_USERNAME = "rokas_max_bot";
    expect(inviteLink("telegram", "AB23CD45")).toBe("https://t.me/rokas_bot?start=AB23CD45");
    expect(inviteLink("max", "AB23CD45")).toBe("https://max.ru/rokas_max_bot?start=AB23CD45");
  });

  it("returns nothing at all when that bot does not exist yet", () => {
    delete process.env.MAX_BOT_USERNAME;
    delete process.env.NEXT_PUBLIC_MAX_BOT_USERNAME;
    // A MAX bot needs a verified organisation profile; until there is one,
    // an invite link would point at max.ru/undefined.
    expect(botUsername("max")).toBe("");
    expect(inviteLink("max", "AB23CD45")).toBe("");
  });

  it("accepts the public form of the MAX bot name, so one variable configures both sides", () => {
    delete process.env.MAX_BOT_USERNAME;
    process.env.NEXT_PUBLIC_MAX_BOT_USERNAME = "rokas_max_bot";
    expect(inviteLink("max", "XY99ZZ88")).toBe("https://max.ru/rokas_max_bot?start=XY99ZZ88");
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
