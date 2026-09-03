import { describe, it, expect } from "vitest";
import { snapshotList, sameJson, diffRows, diffAssignees, upsertById, removeById, type WithId } from "./trackerSync";

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
