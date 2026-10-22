import { beforeEach, describe, expect, it, vi } from "vitest";

// The store subscribes to auth and realtime only when someone subscribes;
// these tests never do, but the import must not reach for a real client.
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/revive", () => ({ onRevive: () => () => {} }));

import { createSharedStore } from "./sharedStore";

// A tiny in-memory localStorage plus a window, so the store believes it is
// in a browser.
function fakeBrowser() {
  const mem = new Map<string, string>();
  const ls = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  vi.stubGlobal("localStorage", ls);
  vi.stubGlobal("window", {});
  return ls;
}

describe("sharedStore — список с прошлого запуска", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("отдаёт сохранённое первым кадром, пока сеть не ответила", async () => {
    const ls = fakeBrowser();
    ls.setItem("kkt_identity", JSON.stringify({ userId: "u1" }));
    // The previous launch answered and wrote the cache.
    const first = createSharedStore<string[]>([], async () => ["Аня", "Игорь"], [], "t1");
    await first.refresh();

    // Next launch: the network has not answered yet.
    let release: (v: string[]) => void = () => {};
    const second = createSharedStore<string[]>([], () => new Promise((r) => (release = r)), [], "t1");
    expect(second.snapshot()).toEqual({ data: ["Аня", "Игорь"], loaded: true });

    // ensure still goes for the truth, and the truth replaces the cache.
    second.ensure();
    release(["Аня"]);
    await second.refresh();
    expect(second.snapshot().data).toEqual(["Аня"]);
  });

  it("чужой кэш не показывается — другой вход на том же компьютере", async () => {
    const ls = fakeBrowser();
    ls.setItem("kkt_identity", JSON.stringify({ userId: "u1" }));
    await createSharedStore<string[]>([], async () => ["Аня"], [], "t2").refresh();

    ls.setItem("kkt_identity", JSON.stringify({ userId: "u2" }));
    const other = createSharedStore<string[]>([], () => new Promise(() => {}), [], "t2");
    expect(other.snapshot()).toEqual({ data: [], loaded: false });
  });

  it("без имени ничего не запоминает", async () => {
    const ls = fakeBrowser();
    ls.setItem("kkt_identity", JSON.stringify({ userId: "u1" }));
    await createSharedStore<string[]>([], async () => ["Аня"]).refresh();
    expect(createSharedStore<string[]>([], () => new Promise(() => {})).snapshot().loaded).toBe(false);
  });
});
