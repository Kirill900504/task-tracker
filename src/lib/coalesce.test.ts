import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { coalescer } from "./coalesce";

// Замер 07.10.2026: участие грузилось трижды за одно открытие трекера.
// Сторож того, что всплеск поводов превращается в одно чтение, а чтение,
// застигнутое новым поводом, — ровно в одно следующее.
describe("coalescer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("пять поводов подряд — одно чтение", async () => {
    const run = vi.fn(async () => {});
    const r = coalescer(run, 150);
    for (let i = 0; i < 5; i++) r.soon();
    await vi.advanceTimersByTimeAsync(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("повод во время чтения — ровно одно чтение следом, не параллельное", async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((res) => (release = res)));
    const r = coalescer(run, 150);
    void r.now();
    r.soon();
    await vi.advanceTimersByTimeAsync(200);
    r.soon();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("после stop ничего не читается", async () => {
    const run = vi.fn(async () => {});
    const r = coalescer(run, 150);
    r.soon();
    r.stop();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).not.toHaveBeenCalled();
  });

  it("помнит, что чтение было только что", async () => {
    const r = coalescer(async () => {}, 150);
    await r.now();
    expect(r.startedWithin(2000)).toBe(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(r.startedWithin(2000)).toBe(false);
  });
});
