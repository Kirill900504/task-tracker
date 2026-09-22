import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Сторож для механизма, из-за отсутствия которого трекер и застывал:
// поводы перечитать данные. Проверять его чтением бесполезно — вопрос
// здесь ровно один, «а позвали ли», и ответ на него даёт только вызов.
//
// Окружение тестов — node, окна и документа в нём нет. Поэтому оба
// подставляются руками, ровно с теми тремя вещами, которые модуль от них
// берёт: слушатели, их снятие и visibilityState.

type Listener = (e: unknown) => void;

function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener: (type: string, fn: Listener) => {
      (listeners.get(type) || listeners.set(type, new Set()).get(type)!).add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => {
      listeners.get(type)?.delete(fn);
    },
    emit: (type: string, e: unknown = {}) => {
      for (const fn of [...(listeners.get(type) || [])]) fn(e);
    },
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

let win: ReturnType<typeof fakeTarget>;
let doc: ReturnType<typeof fakeTarget> & { visibilityState: string };

async function load() {
  vi.resetModules();
  return (await import("./revive")).onRevive;
}

beforeEach(() => {
  vi.useFakeTimers();
  win = fakeTarget();
  doc = Object.assign(fakeTarget(), { visibilityState: "visible" });
  Object.assign(globalThis, { window: win, document: doc });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
});

describe("onRevive", () => {
  it("зовёт, когда человек вернулся к вкладке", async () => {
    const onRevive = await load();
    const fn = vi.fn();
    onRevive(fn, { minGapMs: 1000 });

    vi.advanceTimersByTime(2000);
    doc.emit("visibilitychange");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("не зовёт, когда вкладку, наоборот, покинули", async () => {
    const onRevive = await load();
    const fn = vi.fn();
    onRevive(fn, { minGapMs: 1000 });

    vi.advanceTimersByTime(2000);
    doc.visibilityState = "hidden";
    doc.emit("visibilitychange");

    expect(fn).not.toHaveBeenCalled();
  });

  it("держит паузу между поводами — Alt+Tab десять раз подряд стоит одного чтения", async () => {
    const onRevive = await load();
    const fn = vi.fn();
    onRevive(fn, { minGapMs: 5000 });

    vi.advanceTimersByTime(6000);
    doc.emit("visibilitychange");
    doc.emit("visibilitychange");
    win.emit("online");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("зовёт по времени, когда поводов нет вовсе", async () => {
    const onRevive = await load();
    const fn = vi.fn();
    onRevive(fn, { everyMs: 60_000 });

    vi.advanceTimersByTime(30_000);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(35_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("возврат «назад» из кэша браузера — тоже повод: страница вернулась вместе с мёртвым сокетом", async () => {
    const onRevive = await load();
    const fn = vi.fn();
    onRevive(fn, { minGapMs: 0 });

    win.emit("pageshow", { persisted: false });
    expect(fn).not.toHaveBeenCalled();

    win.emit("pageshow", { persisted: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("отписка снимает слушатели и таймер — иначе хук, живущий в каждой карточке, оставлял бы их десятками", async () => {
    const onRevive = await load();
    const stop = onRevive(vi.fn());
    expect(doc.count("visibilitychange")).toBe(1);

    stop();

    expect(doc.count("visibilitychange")).toBe(0);
    expect(win.count("online")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("слушатели окна одни на всех подписчиков", async () => {
    const onRevive = await load();
    const a = vi.fn();
    const b = vi.fn();
    const stopA = onRevive(a, { minGapMs: 0 });
    const stopB = onRevive(b, { minGapMs: 0 });

    expect(doc.count("visibilitychange")).toBe(1);
    doc.emit("visibilitychange");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    // Пока жив хоть один — слушатели на месте.
    stopA();
    expect(doc.count("visibilitychange")).toBe(1);
    stopB();
    expect(doc.count("visibilitychange")).toBe(0);
  });
});
