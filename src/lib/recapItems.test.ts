import { describe, expect, it } from "vitest";
import { recapItems } from "./recapItems";

describe("итог встречи → пункты", () => {
  it("строки и маркеры списка", () => {
    expect(recapItems("- Обзвонить филиалы\n• Сверить прайс\n2) Подготовить смету\n\n")).toEqual([
      "Обзвонить филиалы",
      "Сверить прайс",
      "Подготовить смету",
    ]);
  });
  it("одна строка через точку с запятой", () => {
    expect(recapItems("купить кассы; обучить кассиров")).toEqual(["купить кассы", "обучить кассиров"]);
  });
  it("пустое и обрывки — ничего", () => {
    expect(recapItems("")).toEqual([]);
    expect(recapItems("-\n.\n")).toEqual([]);
  });
});
