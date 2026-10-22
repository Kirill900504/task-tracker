import { describe, expect, it } from "vitest";
import { cleanBoardFilter, matchesBoardFilter, toggleBoardFilter } from "./boardFilter";
import type { Task } from "@/types/tracker";

const me = "user-me";
const task = (createdBy: string) => ({ id: "t", createdBy }) as Task;
const mineTask = task(me);
const theirs = task("someone-else");

describe("фильтры доски складываются", () => {
  it("ни одной кнопки — вся доска", () => {
    expect(matchesBoardFilter([], theirs, "none", me)).toBe(true);
  });

  it("«Помогаю» — соисполнитель и наблюдатель, но не исполнитель", () => {
    expect(matchesBoardFilter(["helping"], theirs, "coexecutor", me)).toBe(true);
    expect(matchesBoardFilter(["helping"], theirs, "watcher", me)).toBe(true);
    expect(matchesBoardFilter(["helping"], theirs, "executor", me)).toBe(false);
  });

  it("«Я поручил» + «Мне» — без задач, где я только наблюдаю", () => {
    const keys = ["assigned", "mine"] as const;
    expect(matchesBoardFilter([...keys], mineTask, "none", me)).toBe(true);
    expect(matchesBoardFilter([...keys], theirs, "executor", me)).toBe(true);
    expect(matchesBoardFilter([...keys], theirs, "watcher", me)).toBe(false);
  });

  it("«Личные» — только задачи самому себе", () => {
    expect(matchesBoardFilter(["personal"], mineTask, "executor", me, true)).toBe(true);
    expect(matchesBoardFilter(["personal"], mineTask, "none", me, false)).toBe(false);
    expect(matchesBoardFilter(["personal"], theirs, "executor", me, false)).toBe(false);
  });

  it("нажатие включает и выключает, порядок — порядок кнопок", () => {
    expect(toggleBoardFilter([], "helping")).toEqual(["helping"]);
    expect(toggleBoardFilter(["helping"], "assigned")).toEqual(["assigned", "helping"]);
    expect(toggleBoardFilter(["assigned", "helping"], "helping")).toEqual(["assigned"]);
  });

  it("сохранённое значение чистится от мусора", () => {
    expect(cleanBoardFilter(["mine", "все", 3])).toEqual(["mine"]);
    expect(cleanBoardFilter("mine")).toEqual([]);
  });
});
