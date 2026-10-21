import { describe, expect, it } from "vitest";
import { writeQueue } from "./writeQueue";

const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve: (v: string | null) => void = () => {};
  const promise = new Promise<string | null>((r) => (resolve = r));
  return { promise, resolve };
}

describe("writeQueue", () => {
  it("пишет в порядке нажатий, даже если первая запись отвечает дольше", async () => {
    const q = writeQueue(() => {});
    const order: string[] = [];
    const slow = deferred();
    const a = q.write(async () => {
      order.push("a:start");
      await slow.promise;
      order.push("a:end");
      return null;
    });
    const b = q.write(async () => {
      order.push("b");
      return null;
    });
    await tick();
    expect(order).toEqual(["a:start"]);
    slow.resolve(null);
    await Promise.all([a, b]);
    expect(order).toEqual(["a:start", "a:end", "b"]);
  });

  it("чтение, пришедшее при летящей записи, экран не трогает (галочка не отжимается)", async () => {
    const q = writeQueue(() => {});
    const applied: string[] = [];
    let again = 0;
    const pending = deferred();
    const write = q.write(() => pending.promise);
    await q.guard(async () => "база без второго нажатия", (v) => applied.push(v), () => again++)();
    expect(applied).toEqual([]);
    pending.resolve(null);
    await write;
    await q.guard(async () => "база с нажатием", (v) => applied.push(v), () => again++)();
    expect(applied).toEqual(["база с нажатием"]);
    expect(again).toBe(0);
  });

  it("чтение, начатое до правки и законченное после неё, выбрасывается и повторяется", async () => {
    const q = writeQueue(() => {});
    const applied: string[] = [];
    let again = 0;
    const slowRead = deferred();
    const reading = q.guard(() => slowRead.promise, (v) => applied.push(v ?? ""), () => again++)();
    await q.write(async () => null);
    slowRead.resolve("старое");
    await reading;
    expect(applied).toEqual([]);
    expect(again).toBe(1);
  });

  it("когда очередь опустела — одно перечитывание; ошибка доходит словами", async () => {
    const errors: string[] = [];
    const q = writeQueue((m) => errors.push(m));
    let rereads = 0;
    q.onSettled(() => rereads++);
    const a = q.write(async () => "Отметка не сохранилась");
    const b = q.write(async () => {
      throw new Error("сеть");
    });
    await Promise.all([a, b]);
    expect(errors).toEqual(["Отметка не сохранилась", "сеть"]);
    expect(rereads).toBe(1);
  });
});
