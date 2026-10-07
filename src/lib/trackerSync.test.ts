import { describe, it, expect } from "vitest";
import { snapshotList, sameJson, sameLists, diffRows, diffAssignees, upsertById, removeById, mergeIncoming, type WithId } from "./trackerSync";

type Item = WithId & { status: string };
const toRow = (x: Item) => ({ id: x.id, status: x.status });

describe("snapshotList", () => {
  it("produces objects independent of the source — mutating the original doesn't affect the snapshot", () => {
    const source: Item[] = [{ id: "a", status: "open" }];
    const snap = snapshotList(source);

    // This is the exact bug from public/legacy-tracker.js: shadow used to be
    // `list.slice()`, a new array of the SAME object references. Mutating a
    // live object (e.g. the done checkbox handler doing `t.status = "done"`)
    // would then silently mutate shadow's copy too, since they were the same
    // object — the next diff would see no difference and never sync the
    // edit. snapshotList() must produce a genuinely separate object per item.
    source[0].status = "done";

    expect(snap[0].status).toBe("open");
    expect(snap[0]).not.toBe(source[0]);
  });
});

describe("sameJson", () => {
  it("is true for structurally equal objects, false otherwise", () => {
    expect(sameJson({ a: 1 }, { a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe("diffRows", () => {
  it("upserts a brand-new item not present in shadow", () => {
    const current: Item[] = [{ id: "a", status: "open" }];
    const { upserts, deleteIds } = diffRows(current, [], toRow);
    expect(upserts).toEqual([{ id: "a", status: "open" }]);
    expect(deleteIds).toEqual([]);
  });

  it("upserts an item whose row shape changed since shadow", () => {
    const shadow: Item[] = [{ id: "a", status: "open" }];
    const current: Item[] = [{ id: "a", status: "done" }];
    const { upserts } = diffRows(current, shadow, toRow);
    expect(upserts).toEqual([{ id: "a", status: "done" }]);
  });

  it("does NOT upsert an item that is unchanged from its own shadow copy — even if it's the same object reference (the historical bug this guards against)", () => {
    const shared: Item = { id: "a", status: "open" };
    // Simulates the pre-fix bug directly: shadow holding the SAME reference
    // as current. diffRows itself must still behave correctly given honest
    // (cloned) inputs — this test documents the contract callers rely on:
    // pass snapshotList() output as `shadow`, never the live array.
    const current: Item[] = [shared];
    const shadow: Item[] = [shared];
    const { upserts } = diffRows(current, shadow, toRow);
    expect(upserts).toEqual([]);
  });

  it("reports ids present in shadow but missing from current as deletes", () => {
    const shadow: Item[] = [
      { id: "a", status: "open" },
      { id: "b", status: "open" },
    ];
    const current: Item[] = [{ id: "a", status: "open" }];
    const { upserts, deleteIds } = diffRows(current, shadow, toRow);
    expect(upserts).toEqual([]);
    expect(deleteIds).toEqual(["b"]);
  });

  it("returns nothing to do when current and a properly cloned shadow are identical", () => {
    const current: Item[] = [{ id: "a", status: "open" }];
    const shadow = snapshotList(current);
    const { upserts, deleteIds } = diffRows(current, shadow, toRow);
    expect(upserts).toEqual([]);
    expect(deleteIds).toEqual([]);
  });
});

describe("upsertById / removeById", () => {
  it("upsertById appends a new item without mutating the source array", () => {
    const list: Item[] = [{ id: "a", status: "open" }];
    const next = upsertById(list, { id: "b", status: "open" });
    expect(next).toHaveLength(2);
    expect(list).toHaveLength(1); // source untouched
  });

  it("upsertById replaces an existing item by id, returning a new array (not mutating in place)", () => {
    const original: Item = { id: "a", status: "open" };
    const list: Item[] = [original];
    const next = upsertById(list, { id: "a", status: "done" });
    expect(next[0]).toEqual({ id: "a", status: "done" });
    expect(original.status).toBe("open"); // original object never mutated
    expect(next).not.toBe(list);
  });

  it("removeById filters by id without mutating the source", () => {
    const list: Item[] = [
      { id: "a", status: "open" },
      { id: "b", status: "open" },
    ];
    const next = removeById(list, "a");
    expect(next.map((x) => x.id)).toEqual(["b"]);
    expect(list).toHaveLength(2);
  });
});

describe("diffAssignees", () => {
  it("finds added and removed names by value, not reference", () => {
    const shadow = ["Аня", "Боря"];
    const current = ["Боря", "Вася"];
    expect(diffAssignees(current, shadow)).toEqual({ added: ["Вася"], removed: ["Аня"] });
  });

  it("is empty when nothing changed", () => {
    expect(diffAssignees(["Аня"], ["Аня"])).toEqual({ added: [], removed: [] });
  });
});

describe("sameLists", () => {
  it("считает одинаковыми объекты, у которых поля записаны в разном порядке", () => {
    // Ровно этот случай и есть настоящий: задачу собирают две функции —
    // taskFromRow из строки базы и форма задачи, — и порядок ключей у них
    // разный. Без этого догон объявлял бы доску изменившейся каждую минуту
    // и перерисовывал её под рукой у человека.
    const fromDb = [{ id: "a", title: "смета", due: "2026-09-22" }];
    const fromForm = [{ due: "2026-09-22", title: "смета", id: "a" }];

    expect(sameJson(fromDb, fromForm)).toBe(false);
    expect(sameLists(fromDb, fromForm)).toBe(true);
  });

  it("видит настоящее изменение", () => {
    expect(sameLists([{ id: "a", status: "open" }], [{ id: "a", status: "done" }])).toBe(false);
  });

  it("видит новую строку и пропавшую", () => {
    expect(sameLists([{ id: "a" }], [{ id: "a" }, { id: "b" }])).toBe(false);
    expect(sameLists([{ id: "a" }, { id: "b" }], [{ id: "a" }])).toBe(false);
  });

  it("порядок самих строк — это изменение: доска сортируется им", () => {
    expect(sameLists([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "a" }])).toBe(false);
  });

  it("вложенные объекты сравниваются так же", () => {
    expect(sameLists([{ id: "a", recur: { days: [1, 2], kind: "week" } }], [{ id: "a", recur: { kind: "week", days: [1, 2] } }])).toBe(true);
    expect(sameLists([{ id: "a", recur: { days: [1, 2] } }], [{ id: "a", recur: { days: [2, 1] } }])).toBe(false);
  });
});

// Пойман на боевом e2e 07.10.2026: эхо первой записи встречи пришло после
// «Успеха» и стёрло его — с экрана и из того, что ушло бы в базу.
describe("mergeIncoming — подписка не стирает неотправленное", () => {
  type M = { id: string; status: string };
  const toRow = (m: M) => ({ id: m.id, status: m.status });

  it("эхо старой записи не трогает строку, изменённую после неё", () => {
    const live: M[] = [{ id: "m1", status: "success" }];
    const shadow: M[] = [{ id: "m1", status: "planned" }];
    const echo = { id: "m1", status: "planned" };
    const out = mergeIncoming(live, shadow, echo, { ...echo }, toRow);
    expect(out.live).toEqual([{ id: "m1", status: "success" }]);
    expect(out.shadow).toEqual([{ id: "m1", status: "planned" }]);
    // А значит, следующий дифф отправит «Успех».
    expect(diffRows(out.live, out.shadow, toRow).upserts).toEqual([{ id: "m1", status: "success" }]);
  });

  it("новая строка, ещё не подтверждённая, тоже не затирается эхом вставки", () => {
    const out = mergeIncoming([{ id: "m2", status: "success" }], [], { id: "m2", status: "planned" }, { id: "m2", status: "planned" }, toRow);
    expect(out.live[0].status).toBe("success");
  });

  it("строку без неотправленной работы подписка обновляет как раньше", () => {
    const live: M[] = [{ id: "m3", status: "planned" }];
    const shadow: M[] = [{ id: "m3", status: "planned" }];
    const fromOtherDevice = { id: "m3", status: "no_result" };
    const out = mergeIncoming(live, shadow, fromOtherDevice, { ...fromOtherDevice }, toRow);
    expect(out.live[0].status).toBe("no_result");
    expect(out.shadow[0].status).toBe("no_result");
  });
});