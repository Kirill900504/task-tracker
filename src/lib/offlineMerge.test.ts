import { describe, it, expect } from "vitest";
import { applyLocalChanges, applyLocalNameChanges, hasUnsyncedWork } from "@/lib/offlineMerge";

type Row = { id: string; title: string; done?: boolean };

const server = (rows: Row[]) => rows;

describe("applyLocalChanges", () => {
  it("keeps an item created while offline", () => {
    const result = applyLocalChanges(
      server([{ id: "a", title: "С сервера" }]),
      [{ id: "a", title: "С сервера" }, { id: "new", title: "Записано без сети" }],
      [{ id: "a", title: "С сервера" }],
    );
    expect(result.map((r) => r.id)).toEqual(["a", "new"]);
  });

  it("keeps an edit made offline over the server's older copy", () => {
    const result = applyLocalChanges(
      server([{ id: "a", title: "Старое название" }]),
      [{ id: "a", title: "Новое название" }],
      [{ id: "a", title: "Старое название" }],
    );
    expect(result[0].title).toBe("Новое название");
  });

  it("drops an item deleted while offline", () => {
    const result = applyLocalChanges(
      server([{ id: "a", title: "Уже удалено локально" }, { id: "b", title: "Осталось" }]),
      [{ id: "b", title: "Осталось" }],
      [{ id: "a", title: "Уже удалено локально" }, { id: "b", title: "Осталось" }],
    );
    expect(result.map((r) => r.id)).toEqual(["b"]);
  });

  it("takes the server's version of anything the user did not touch", () => {
    // Changed on the phone in the meantime; untouched in this cached copy.
    const result = applyLocalChanges(
      server([{ id: "a", title: "Изменено на телефоне" }]),
      [{ id: "a", title: "Как было" }],
      [{ id: "a", title: "Как было" }],
    );
    expect(result[0].title).toBe("Изменено на телефоне");
  });

  it("does not resurrect a row deleted on another device", () => {
    // Known to the cache as synced, absent from the server now, untouched
    // locally — that is a delete that happened elsewhere.
    const result = applyLocalChanges(server([]), [{ id: "a", title: "Удалено на телефоне" }], [{ id: "a", title: "Удалено на телефоне" }]);
    expect(result).toEqual([]);
  });

  it("honours a delete from another device even over a local edit", () => {
    // Two devices disagreeing. The delete wins: an item that comes back from
    // the dead is the more confusing outcome, and it is recoverable there —
    // every delete in the tracker is soft, with an undo.
    const result = applyLocalChanges(server([]), [{ id: "a", title: "Дописал без сети" }], [{ id: "a", title: "Как было" }]);
    expect(result).toEqual([]);
  });

  it("returns the server list untouched when nothing was changed offline", () => {
    const rows = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
    expect(applyLocalChanges(server(rows), rows, rows)).toEqual(rows);
  });

  it("handles an empty cache", () => {
    const rows = [{ id: "a", title: "A" }];
    expect(applyLocalChanges(server(rows), [], [])).toEqual(rows);
  });
});

describe("applyLocalNameChanges", () => {
  it("keeps a name added offline", () => {
    expect(applyLocalNameChanges(["Игорь"], ["Игорь", "Никита"], ["Игорь"])).toEqual(["Игорь", "Никита"]);
  });

  it("drops a name removed offline", () => {
    expect(applyLocalNameChanges(["Игорь", "Никита"], ["Игорь"], ["Игорь", "Никита"])).toEqual(["Игорь"]);
  });

  it("keeps a name another device added", () => {
    expect(applyLocalNameChanges(["Игорь", "Наталья"], ["Игорь"], ["Игорь"])).toEqual(["Игорь", "Наталья"]);
  });
});

describe("hasUnsyncedWork", () => {
  it("is false when the two copies agree", () => {
    expect(hasUnsyncedWork({ tasks: [{ id: "a" }] }, { tasks: [{ id: "a" }] })).toBe(false);
  });

  it("is true when anything differs", () => {
    expect(hasUnsyncedWork({ tasks: [{ id: "a" }], ideas: [] }, { tasks: [], ideas: [] })).toBe(true);
  });
});
