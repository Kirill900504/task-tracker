import { describe, expect, it } from "vitest";
import { RESTORE_SCRIPT, SNAPSHOT_KEY } from "./bootSnapshot";

// The restore runs inline before React, as a string, so it is tested as that
// exact string: run in a hand-made page with a cookie jar, localStorage and
// one slot element. Every refusal below is a case where showing the copy
// would be worse than the skeleton — someone else's tasks above all.

const USER = "11111111-2222-3333-4444-555555555555";

function sessionCookie(userId: string, chunks = 1): string {
  const json = JSON.stringify({ access_token: "x", user: { id: userId, user_metadata: { name: "Кирилл" } } });
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const value = "base64-" + b64;
  if (chunks === 1) return `sb-abc-auth-token=${value}`;
  const size = Math.ceil(value.length / chunks);
  const parts: string[] = [];
  for (let i = 0; i < chunks; i++) parts.push(`sb-abc-auth-token.${i}=${value.slice(i * size, (i + 1) * size)}`);
  // Out of order on purpose: the browser does not promise cookie order.
  return parts.reverse().join("; ");
}

function run(opts: {
  cookie: string;
  stored?: unknown;
  mobile?: boolean;
  webdriver?: boolean;
  slot?: boolean;
}) {
  const el = { innerHTML: "" };
  const classes = new Set<string>();
  const store = new Map<string, string>();
  if (opts.stored !== undefined) store.set(SNAPSHOT_KEY, JSON.stringify(opts.stored));
  const env = {
    document: {
      cookie: opts.cookie,
      getElementById: (id: string) => (id === "bootSnapshot" && opts.slot !== false ? el : null),
      documentElement: { classList: { add: (c: string) => classes.add(c) } },
    },
    navigator: { webdriver: !!opts.webdriver },
    localStorage: { getItem: (k: string) => store.get(k) ?? null },
    window: { matchMedia: () => ({ matches: !!opts.mobile }) },
    atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
    TextDecoder,
    Uint8Array,
    JSON,
    Date,
  };
  new Function(...Object.keys(env), RESTORE_SCRIPT)(...Object.values(env));
  return { html: el.innerHTML, marked: classes.has("boot-snap") };
}

const fresh = (u = USER, m = false) => ({ u, m, t: Date.now(), h: "<header>Задачи</header>" });

describe("RESTORE_SCRIPT", () => {
  it("кладёт снимок того же человека и прячет каркас", () => {
    const r = run({ cookie: "other=1; " + sessionCookie(USER), stored: fresh() });
    expect(r.html).toBe("<header>Задачи</header>");
    expect(r.marked).toBe(true);
  });

  it("собирает куку, разбитую на части, в любом порядке", () => {
    expect(run({ cookie: sessionCookie(USER, 3), stored: fresh() }).html).toContain("Задачи");
  });

  it("чужой снимок не показывает", () => {
    const r = run({ cookie: sessionCookie("99999999-0000-0000-0000-000000000000"), stored: fresh() });
    expect(r.html).toBe("");
    expect(r.marked).toBe(false);
  });

  it("без входа не показывает ничего", () => {
    expect(run({ cookie: "", stored: fresh() }).html).toBe("");
  });

  it("снимок компьютера не ставится в окно телефона", () => {
    expect(run({ cookie: sessionCookie(USER), stored: fresh(USER, false), mobile: true }).html).toBe("");
    expect(run({ cookie: sessionCookie(USER), stored: fresh(USER, true), mobile: true }).html).toContain("Задачи");
  });

  it("старый снимок и автотесты — каркас", () => {
    expect(run({ cookie: sessionCookie(USER), stored: { ...fresh(), t: Date.now() - 4 * 24 * 3600_000 } }).html).toBe("");
    expect(run({ cookie: sessionCookie(USER), stored: fresh(), webdriver: true }).html).toBe("");
  });

  it("без места под снимок и без снимка молчит, а битые данные не роняют страницу", () => {
    expect(run({ cookie: sessionCookie(USER), stored: fresh(), slot: false }).html).toBe("");
    expect(run({ cookie: sessionCookie(USER) }).html).toBe("");
    expect(run({ cookie: "sb-abc-auth-token=base64-%%%", stored: fresh() }).html).toBe("");
  });
});
