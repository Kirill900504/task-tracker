import { describe, it, expect, vi } from "vitest";
import { checkRateLimit } from "./rateLimit";
import type { SupabaseClient } from "@supabase/supabase-js";

// Minimal fake mirroring the chainable shape checkRateLimit actually calls:
// .from(table).select(...).eq(...).eq(...).gte(...) -> {count, error}
// .from(table).insert(...)
function fakeClient(opts: { count: number; selectError?: { message: string } }) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const chain = {
    eq: () => chain,
    gte: () => Promise.resolve({ count: opts.count, error: opts.selectError ?? null }),
  };
  const from = vi.fn(() => ({
    select: () => chain,
    insert,
  }));
  return { client: { from } as unknown as SupabaseClient, insert };
}

describe("checkRateLimit", () => {
  it("allows the request and logs it when under the limit", async () => {
    const { client, insert } = fakeClient({ count: 3 });
    const res = await checkRateLimit(client, "user-1", "quick-add", 20, 60);
    expect(res.allowed).toBe(true);
    expect(insert).toHaveBeenCalledWith({ user_id: "user-1", route: "quick-add" });
  });

  it("blocks the request once the count reaches the limit", async () => {
    const { client, insert } = fakeClient({ count: 20 });
    const res = await checkRateLimit(client, "user-1", "quick-add", 20, 60);
    expect(res.allowed).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("fails open (allows the request) if the count query errors — e.g. the migration hasn't run yet", async () => {
    const { client, insert } = fakeClient({ count: 0, selectError: { message: "relation does not exist" } });
    const res = await checkRateLimit(client, "user-1", "quick-add", 20, 60);
    expect(res.allowed).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });

  it("fails open if the client throws synchronously", async () => {
    const client = {
      from: () => {
        throw new Error("network down");
      },
    } as unknown as SupabaseClient;
    const res = await checkRateLimit(client, "user-1", "quick-add", 20, 60);
    expect(res.allowed).toBe(true);
  });
});
