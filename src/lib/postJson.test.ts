import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The outbox keeps its queue in localStorage; vitest runs in node.
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

async function load() {
  const outbox = await import("./outbox");
  const { postJson } = await import("./postJson");
  return { outbox, postJson };
}

describe("postJson", () => {
  // Макаров's «Сделал» that never arrived: it must neither vanish nor be
  // rolled back — it waits in the outbox and leaves when the network is back.
  it("queues the answer when the request never arrives, and sends it later", async () => {
    const { outbox, postJson } = await load();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const onFail = vi.fn();
    await expect(postJson("/api/workspace/report", { action: "done" }, { fallback: "x", onFail })).resolves.toBeNull();
    expect(onFail).not.toHaveBeenCalled();
    expect(outbox.pendingPosts("/api/workspace/report")).toHaveLength(1);

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await outbox.flushOutbox();
    expect(outbox.pendingPosts("/api/workspace/report")).toHaveLength(0);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual({ action: "done" });
  });

  it("keeps the order of presses: a new answer waits behind the queued one", async () => {
    const { outbox, postJson } = await load();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await postJson("/api/workspace/report", { action: "accept" }, { fallback: "x" });
    await postJson("/api/workspace/report", { action: "done" }, { fallback: "x" });
    expect(outbox.outboxSnapshot().map((e) => (e.kind === "post" ? e.body.action : ""))).toEqual(["accept", "done"]);

    const sent: string[] = [];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).action);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await outbox.flushOutbox();
    expect(sent).toEqual(["accept", "done"]);
  });

  it("rolls back and names the server's reason on a refusal", async () => {
    const { outbox, postJson } = await load();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Уже ответили" }), { status: 409 })));
    const onFail = vi.fn();
    await expect(postJson("/api/x", {}, { fallback: "x", onFail })).rejects.toThrow("Уже ответили");
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(outbox.outboxSnapshot()).toHaveLength(0);
  });

  // 404 is «the meeting made offline has not reached the cloud yet».
  it("retries a not-found instead of dropping it", async () => {
    const { outbox, postJson } = await load();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Нет такой" }), { status: 404 })));
    await expect(postJson("/api/workspace/recap", {}, { fallback: "x" })).resolves.toBeNull();
    expect(outbox.pendingPosts("/api/workspace/recap")).toHaveLength(1);
  });

  it("drops a queued answer the server refuses later, and says so", async () => {
    const { outbox, postJson } = await load();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const dropped = vi.fn();
    vi.stubGlobal("window", Object.assign(new EventTarget(), { dispatchEvent: (e: Event) => (dropped(e.type), true) }));
    await postJson("/api/workspace/report", { action: "done" }, { fallback: "x" });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Задача закрыта" }), { status: 403 }));
    await outbox.flushOutbox();
    expect(outbox.outboxSnapshot()).toHaveLength(0);
    expect(dropped).toHaveBeenCalledWith(outbox.OUTBOX_DROPPED_EVENT);
  });

  it("leaves the screen alone on success", async () => {
    const { postJson } = await load();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const onFail = vi.fn();
    await expect(postJson("/api/x", {}, { fallback: "x", onFail })).resolves.toEqual({ ok: true });
    expect(onFail).not.toHaveBeenCalled();
  });
});
