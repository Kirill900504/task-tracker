import { describe, it, expect } from "vitest";
import type { Idea } from "@/types/tracker";
import { sortIdeasForList } from "./ideaDisplay";

function baseIdea(overrides: Partial<Idea>): Idea {
  return { id: "i1", text: "test", important: false, done: false, createdAt: "01.09.2026 10:00", ...overrides };
}

describe("sortIdeasForList", () => {
  it("hides done ideas unless showDone is true", () => {
    const active = baseIdea({ id: "a", done: false });
    const done = baseIdea({ id: "b", done: true });
    expect(sortIdeasForList([active, done], false).map((i) => i.id)).toEqual(["a"]);
    expect(sortIdeasForList([active, done], true).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("shows newest first among active ideas, done ideas sorted after active ones", () => {
    const first = baseIdea({ id: "a" });
    const second = baseIdea({ id: "b" });
    const doneOne = baseIdea({ id: "c", done: true });
    // Insertion order: a, b, c (c done) — newest-first among active means b
    // before a, and done items (even though inserted last) sort after both.
    expect(sortIdeasForList([first, second, doneOne], true).map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate the input array", () => {
    const list = [baseIdea({ id: "a" }), baseIdea({ id: "b" })];
    const original = list.slice();
    sortIdeasForList(list, true);
    expect(list).toEqual(original);
  });
});
