import { describe, expect, test } from "vitest";
import { exactSelfPhrase } from "@/lib/botSelf";

// Фразы возврата разбирает код, а не модель: на боевом модель с памятью
// разговора дважды из трёх отвечала на «верни … на доску» не тем типом.
describe("exactSelfPhrase", () => {
  test("«верни … на доску» — вернуть задачу", () => {
    expect(exactSelfPhrase("верни отчёт для банка на доску")).toEqual([{ tool: "snooze_task", input: { query: "отчёт для банка", back: true }, droppedNames: [] }]);
    expect(exactSelfPhrase("Верни смету обратно на доску!")?.[0].input).toEqual({ query: "смету", back: true });
    expect(exactSelfPhrase("не откладывай смету")?.[0].input).toEqual({ query: "смету", back: true });
  });

  test("«я вернулся» — снять отсутствие", () => {
    for (const p of ["я вернулся", "Я вернулась.", "я уже на месте", "я снова на месте"]) {
      expect(exactSelfPhrase(p)?.[0].tool, p).toBe("away");
    }
  });

  // Всё остальное — модели: «верни смету в работу» — это открыть заново,
  // а не вернуть на доску.
  test("остальное не перехватывается", () => {
    for (const p of ["верни смету в работу", "верни смету на доработку — нет подписи", "отложи смету до понедельника", "я вернусь в пятницу"]) {
      expect(exactSelfPhrase(p), p).toBeNull();
    }
  });
});
