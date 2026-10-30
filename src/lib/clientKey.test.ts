import { describe, expect, it } from "vitest";
import { clientKeyOf } from "./clientKey";

const req = (headers: Record<string, string>) => new Request("https://example.org/api/x", { headers });

describe("clientKeyOf", () => {
  it("один адрес — один ключ в форме uuid", () => {
    const a = clientKeyOf(req({ "x-real-ip": "203.0.113.7" }));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(clientKeyOf(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(a);
  });

  it("разные адреса — разные ключи, и сам адрес в ключе не виден", () => {
    const a = clientKeyOf(req({ "x-real-ip": "203.0.113.7" }));
    const b = clientKeyOf(req({ "x-real-ip": "203.0.113.8" }));
    expect(a).not.toBe(b);
    expect(a).not.toContain("203");
  });

  it("без адреса ключа нет", () => {
    expect(clientKeyOf(req({}))).toBeNull();
  });
});
