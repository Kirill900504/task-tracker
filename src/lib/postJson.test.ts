import { afterEach, describe, expect, it, vi } from "vitest";
import { NOT_SENT_TEXT, postJson } from "./postJson";

afterEach(() => vi.unstubAllGlobals());

describe("postJson", () => {
  // The case that cost Макаров two «закрытых» задач: fetch throws instead of
  // answering, and the optimistic «Сделал» must be rolled back all the same.
  it("rolls the screen back when the request never arrives", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const onFail = vi.fn();
    await expect(postJson("/api/workspace/report", {}, { fallback: "x", onFail })).rejects.toThrow(NOT_SENT_TEXT);
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it("rolls back and names the server's reason on a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Уже ответили" }), { status: 409 })));
    const onFail = vi.fn();
    await expect(postJson("/api/x", {}, { fallback: "x", onFail })).rejects.toThrow("Уже ответили");
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it("leaves the screen alone on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const onFail = vi.fn();
    await expect(postJson("/api/x", {}, { fallback: "x", onFail })).resolves.toEqual({ ok: true });
    expect(onFail).not.toHaveBeenCalled();
  });
});
