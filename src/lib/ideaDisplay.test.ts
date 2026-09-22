import { describe, it, expect } from "vitest";
import type { Idea } from "@/types/tracker";
import { doneIdeasNewestFirst, sortIdeasForList } from "./ideaDisplay";

function baseIdea(overrides: Partial<Idea>): Idea {
  return { id: "i1", text: "test", important: false, done: false, createdAt: "01.09.2026 10:00", doneAt: "", ...overrides };
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

  it("puts the most recently ticked-off idea first among the done ones", () => {
    const active = baseIdea({ id: "act" });
    const early = baseIdea({ id: "early", done: true, doneAt: "2026-09-01T10:00:00.000Z" });
    const late = baseIdea({ id: "late", done: true, doneAt: "2026-09-05T18:00:00.000Z" });
    expect(sortIdeasForList([early, late, active], true).map((i) => i.id)).toEqual(["act", "late", "early"]);
  });

  it("sorts done ideas with no doneAt after those that have one", () => {
    const legacy = baseIdea({ id: "legacy", done: true, doneAt: "" });
    const stamped = baseIdea({ id: "stamped", done: true, doneAt: "2026-09-01T10:00:00.000Z" });
    expect(sortIdeasForList([legacy, stamped], true).map((i) => i.id)).toEqual(["stamped", "legacy"]);
  });

  it("does not mutate the input array", () => {
    const list = [baseIdea({ id: "a" }), baseIdea({ id: "b" })];
    const original = list.slice();
    sortIdeasForList(list, true);
    expect(list).toEqual(original);
  });
});

describe("doneIdeasNewestFirst", () => {
  it("ставит наверх вычеркнутое последним, а не записанное первым", () => {
    // Старая мысль, закрытая только что, обязана оказаться выше свежей,
    // закрытой неделю назад: список открывают, чтобы вернуть последнее.
    const старая = baseIdea({ id: "старая", done: true, createdAt: "01.08.2026 10:00", doneAt: "2026-09-21T09:00:00.000Z" });
    const свежая = baseIdea({ id: "свежая", done: true, createdAt: "15.09.2026 10:00", doneAt: "2026-09-14T09:00:00.000Z" });
    expect(doneIdeasNewestFirst([старая, свежая]).map((i) => i.id)).toEqual(["старая", "свежая"]);
  });

  it("не пускает в список живые мысли", () => {
    const живая = baseIdea({ id: "живая" });
    const вычеркнутая = baseIdea({ id: "вычеркнутая", done: true, doneAt: "2026-09-20T09:00:00.000Z" });
    expect(doneIdeasNewestFirst([живая, вычеркнутая]).map((i) => i.id)).toEqual(["вычеркнутая"]);
  });

  it("мысли без даты вычёркивания уходят вниз, а не наверх", () => {
    const давняя = baseIdea({ id: "давняя", done: true, doneAt: "" });
    const вчерашняя = baseIdea({ id: "вчерашняя", done: true, doneAt: "2026-09-20T09:00:00.000Z" });
    expect(doneIdeasNewestFirst([давняя, вчерашняя]).map((i) => i.id)).toEqual(["вчерашняя", "давняя"]);
  });
});

describe("важные мысли", () => {
  const idea = (id: string, extra: Partial<Idea> = {}): Idea => ({
    id,
    text: id,
    important: false,
    done: false,
    createdAt: "",
    doneAt: "",
    ...extra,
  });

  it("поднимаются над остальными активными", () => {
    // Порядок массива — как он приходит из базы: старые первыми.
    const list = [idea("старая"), idea("важная", { important: true }), idea("свежая")];
    expect(sortIdeasForList(list, false).map((i) => i.id)).toEqual(["важная", "свежая", "старая"]);
  });

  it("но вычеркнутые остаются внизу, важные они или нет", () => {
    const list = [idea("готовая", { important: true, done: true, doneAt: "2026-09-19" }), idea("живая")];
    expect(sortIdeasForList(list, true).map((i) => i.id)).toEqual(["живая", "готовая"]);
  });
});
