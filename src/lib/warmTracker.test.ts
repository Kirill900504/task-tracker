import { afterEach, describe, expect, it, vi } from "vitest";
import { assetUrls } from "./warmTracker";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/shellCache", () => ({ storeShell: vi.fn(async () => {}) }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("assetUrls", () => {
  it("берёт файлы сборки из оболочки, каждый по разу, и только их", () => {
    const html = `<link rel="stylesheet" href="/_next/static/immutable/chunks/a1.css"/>
      <script src="/_next/static/immutable/chunks/b2.js" async></script>
      <script src="/_next/static/immutable/chunks/b2.js" async></script>
      <script>self.__next_f.push([1,"I[\\"/_next/static/immutable/chunks/c3.js\\"]"])</script>
      <img src="/favicon.png"/><script src="https://example.com/x.js"></script>`;
    expect(assetUrls(html)).toEqual([
      "/_next/static/immutable/chunks/a1.css",
      "/_next/static/immutable/chunks/b2.js",
      "/_next/static/immutable/chunks/c3.js",
    ]);
  });
});

describe("переход после входа", () => {
  function worker(controlled = false) {
    const target = Object.assign(new EventTarget(), { controller: controlled ? {} : null as object | null, ready: Promise.resolve({ active: {} }) });
    vi.stubGlobal("navigator", { serviceWorker: target });
    return target;
  }

  it("активная регистрация без controller ещё не разрешает переход", async () => {
    vi.useFakeTimers();
    const sw = worker();
    const { workerSettled } = await import("./warmTracker");
    let done = false;
    const wait = workerSettled().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    sw.controller = {};
    sw.dispatchEvent(new Event("controllerchange"));
    await wait;
    expect(done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("отказ воркера не задерживает вход дольше общего лимита и снимает слушатель", async () => {
    vi.useFakeTimers();
    const sw = worker();
    const remove = vi.spyOn(sw, "removeEventListener");
    const { workerSettled } = await import("./warmTracker");
    const wait = workerSettled(1500);
    await vi.advanceTimersByTimeAsync(1500);
    await wait;
    expect(remove).toHaveBeenCalledWith("controllerchange", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ждёт завершения записи прогретой оболочки даже с готовым controller", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    worker(true);
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html></html>")));
    let release!: () => void;
    const { storeShell } = await import("./shellCache");
    vi.mocked(storeShell).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const { warmTracker, workerSettled } = await import("./warmTracker");
    warmTracker();
    let done = false;
    const wait = workerSettled().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(10);
    expect(storeShell).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    release();
    await wait;
    expect(done).toBe(true);
  });
});
