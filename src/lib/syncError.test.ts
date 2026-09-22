import { describe, expect, it } from "vitest";
import { describeDbError, syncFailure } from "./syncError";

// Сторож ровно на ту ошибку, которую увидел Кирилл: отказ Supabase — не
// Error, и всякий, кто сводит его к строке сам, получает «[object Object]».
describe("describeDbError", () => {
  it("разбирает отказ PostgREST, а не превращает его в [object Object]", () => {
    const said = describeDbError({
      message: "duplicate key value violates unique constraint",
      details: "Key (task_id, assignee_id) already exists.",
      hint: null,
      code: "23505",
    });
    expect(said).toContain("duplicate key");
    expect(said).toContain("already exists");
    expect(said).toContain("23505");
    expect(said).not.toContain("[object");
  });

  it("берёт текст обычной ошибки как есть", () => {
    expect(describeDbError(new Error("network timeout"))).toBe("network timeout");
  });

  it("не отдаёт пустую строку, даже когда сказать нечего", () => {
    expect(describeDbError({}).length).toBeGreaterThan(0);
    expect(describeDbError(null).length).toBeGreaterThan(0);
  });
});

describe("syncFailure", () => {
  it("называет таблицу и действие — без них отказ остаётся загадкой", () => {
    const failure = syncFailure("Задачи", "запись", { message: "new row violates row-level security policy" });
    expect(failure.message).toContain("Задачи");
    expect(failure.message).toContain("запись");
    expect(failure.message).toContain("row-level security");
  });

  it("сохраняет исходный отказ в cause — в консоли он полезнее любого пересказа", () => {
    const original = { message: "boom", code: "42501" };
    expect(syncFailure("Встречи", "удаление", original).cause).toBe(original);
  });
});
