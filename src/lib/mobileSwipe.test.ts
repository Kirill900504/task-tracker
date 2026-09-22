import { describe, expect, it } from "vitest";
import { neighbour, verdict } from "./mobileSwipe";

const TABS = ["meetings", "tasks", "review", "ideas", "today"] as const;

describe("листание разделов пальцем", () => {
  it("палец влево — следующий раздел, вправо — предыдущий", () => {
    expect(verdict(-120, 4)).toBe("next");
    expect(verdict(120, 4)).toBe("prev");
  });

  // Главная опасность жеста: он живёт на том же экране, где списки листают
  // вверх. Палец, ведущий список, почти всегда уходит и вбок, и без
  // проверки соотношения разделы переключались бы сами по себе — то есть
  // человек листал бы задачи и оказывался во встречах.
  it("прокрутка списка не считается листанием", () => {
    expect(verdict(-80, 200)).toBe("none");
    expect(verdict(75, 60)).toBe("none");
  });

  it("дрожание руки не считается ничем", () => {
    expect(verdict(-30, 2)).toBe("none");
    expect(verdict(0, 0)).toBe("none");
  });

  it("соседний раздел берётся по порядку полосы", () => {
    expect(neighbour(TABS, "tasks", "next")).toBe("review");
    expect(neighbour(TABS, "tasks", "prev")).toBe("meetings");
  });

  // Крайние не заворачиваются в кольцо нарочно: порядок полосы повторяет
  // расположение блоков на компьютере, и прыжок с первого раздела на
  // последний разрушил бы ощущение ряда.
  it("с краёв ряда не перескакивает на другой край", () => {
    expect(neighbour(TABS, "meetings", "prev")).toBeNull();
    expect(neighbour(TABS, "today", "next")).toBeNull();
  });

  it("без жеста не двигается никуда", () => {
    expect(neighbour(TABS, "tasks", "none")).toBeNull();
  });
});
