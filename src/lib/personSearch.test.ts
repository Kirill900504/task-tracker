import { describe, expect, it } from "vitest";
import { matchesPerson } from "./personSearch";

describe("matchesPerson", () => {
  it("находит по началу имени или фамилии", () => {
    expect(matchesPerson("Юрий Нодберг", "нод")).toBe(true);
    expect(matchesPerson("Юрий Нодберг", "Юр")).toBe(true);
    expect(matchesPerson("Юрий Нодберг", "берг")).toBe(false);
  });

  it("понимает два слова в любом порядке", () => {
    expect(matchesPerson("Юрий Нодберг", "нод юр")).toBe(true);
    expect(matchesPerson("Юрий Черкашин", "юр нод")).toBe(false);
  });

  it("не различает ё и е и не видит пометку (я)", () => {
    expect(matchesPerson("Алёна Петрова", "ален")).toBe(true);
    expect(matchesPerson("Кирилл Кучеренко (я)", "я")).toBe(false);
  });

  it("пустой запрос пропускает всех", () => {
    expect(matchesPerson("Кто угодно", "  ")).toBe(true);
  });
});
