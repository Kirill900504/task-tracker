import { describe, expect, it } from "vitest";
import { bestMatches, coverage, matchScore } from "@/lib/itemMatch";

// Название из трекера — с опечаткой, как оно и было 19.10.2026.
const TELEMOST = "телемост с Вадимом Яцнко (директолог)";
const PACK = "Собрать пачку в первых числах ноября Костив Котов Долгов Макаров";

describe("подбор по словам, а не по подстроке", () => {
  it("опечатка в фамилии и другой регистр — та же встреча", () => {
    expect(matchScore(TELEMOST, "Встреча Телемост с Вадимом Яценко")).toBe(1);
  });
  it("одно слово темы достаточно", () => {
    expect(bestMatches([{ title: TELEMOST }, { title: PACK }], "телемост")).toEqual([{ title: TELEMOST }]);
  });
  it("другой падеж", () => {
    expect(matchScore(TELEMOST, "телемоста с Вадимом")).toBe(1);
  });
  it("служебные слова просьбы не совпадают ни с чем", () => {
    expect(bestMatches([{ title: "Встреча с банком" }], "перенеси эту встречу")).toEqual([]);
  });
  it("несколько равных — все они", () => {
    const items = [{ title: "Смета склад" }, { title: "Смета офис" }];
    expect(bestMatches(items, "смета")).toHaveLength(2);
  });
});

describe("название внутри сообщения бота, на которое ответили", () => {
  it("напоминание за 15 минут", () => {
    const text = "🔔 Через 15 минут: «телемост с Вадимом Яцнко (директолог)» (19.10.2026, 14:00)\nбудут: Евгений Макаров";
    expect(coverage(TELEMOST, text)).toBe(1);
    expect(coverage(PACK, text)).toBeLessThan(0.5);
  });
});
