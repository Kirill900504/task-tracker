import { describe, expect, test } from "vitest";
import { GUIDE, guideAnswer, guideIndex, guideTopicsForPrompt } from "@/lib/botGuide";
import { TOOL_BY_TYPE } from "@/lib/quickAdd";

describe("справочник бота", () => {
  test("у каждой темы есть заголовок и хотя бы одна строка о боте", () => {
    for (const [key, t] of Object.entries(GUIDE)) {
      expect(t.title, key).toBeTruthy();
      expect(t.bot.length, key).toBeGreaterThan(0);
    }
  });

  // Модель выбирает тему по ключу из подсказки: ключ, которого там нет,
  // не выберется никогда — тема будет написана и недостижима.
  test("все ключи тем попадают в подсказку модели", () => {
    const prompt = guideTopicsForPrompt();
    for (const key of Object.keys(GUIDE)) expect(prompt).toContain(key + " —");
  });

  test("ответ по теме — её заголовок и строки", () => {
    const text = guideAnswer("task_snooze", "assigner");
    expect(text.startsWith(GUIDE.task_snooze.title)).toBe(true);
    expect(text).toContain("отложи смету до понедельника");
  });

  // Модель вернула пустую или придуманную тему — показываем оглавление,
  // а не выдумку.
  test("неизвестная или пустая тема — оглавление", () => {
    expect(guideAnswer("", "assigner")).toBe(guideIndex("assigner"));
    expect(guideAnswer("delegate_everything", "assigner")).toBe(guideIndex("assigner"));
  });

  test("получателю оглавление без того, что делает только постановщик", () => {
    const index = guideIndex("recipient");
    expect(index).not.toContain(GUIDE.task_review.title);
    expect(index).toContain(GUIDE.task_answer.title);
  });

  test("тема постановщика, спрошенная получателем, говорит, кто это делает", () => {
    expect(guideAnswer("task_review", "recipient")).toContain("тот, кто поставил задачу");
  });

  // Новые типы разбора доходят до бота — без строки в TOOL_BY_TYPE модель
  // ответит типом, которого конвейер не знает, и человек получит «не понял».
  test("типы howto, snooze_task и away разобраны в инструменты", () => {
    expect(TOOL_BY_TYPE.howto).toBe("howto");
    expect(TOOL_BY_TYPE.snooze_task).toBe("snooze_task");
    expect(TOOL_BY_TYPE.away).toBe("away");
  });
});
