import { describe, it, expect } from "vitest";
import { matchQueryCommand } from "./telegramQueries";

describe("matchQueryCommand", () => {
  it("matches exact known trigger phrases, case-insensitively", () => {
    expect(matchQueryCommand("сегодня")).toBe("today");
    expect(matchQueryCommand("Что на сегодня")).toBe("today");
    expect(matchQueryCommand("просрочено")).toBe("overdue");
    expect(matchQueryCommand("встречи")).toBe("meetings");
    expect(matchQueryCommand("помощь")).toBe("help");
    expect(matchQueryCommand("/today")).toBe("today");
  });

  it("tolerates a trailing question mark", () => {
    expect(matchQueryCommand("что на сегодня?")).toBe("today");
  });

  // Regression guard: a substring match here would swallow a genuine
  // quick-add phrase instead of creating the task.
  it("does NOT match a quick-add phrase that merely contains a trigger word", () => {
    expect(matchQueryCommand("сегодня позвонить Иванову")).toBeNull();
    expect(matchQueryCommand("завтра встречи с клиентом в 15:00")).toBeNull();
    expect(matchQueryCommand("напомни про просроченный платёж поставщику")).toBeNull();
  });

  it("returns null for unrelated text", () => {
    expect(matchQueryCommand("привет")).toBeNull();
  });
});

describe("команда «ошибки»", () => {
  it("узнаёт вопрос о поломках в нескольких формах", () => {
    expect(matchQueryCommand("ошибки")).toBe("crashes");
    expect(matchQueryCommand("Поломки")).toBe("crashes");
    expect(matchQueryCommand("что сломалось?")).toBe("crashes");
    expect(matchQueryCommand("/errors")).toBe("crashes");
  });

  it("не срабатывает на фразу, где это слово внутри", () => {
    // Иначе «исправь ошибки в смете» заведёт не задачу, а отчёт о поломках.
    expect(matchQueryCommand("исправь ошибки в смете")).toBe(null);
    expect(matchQueryCommand("разобрать поломки оборудования")).toBe(null);
  });
});
