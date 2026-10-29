import { describe, it, expect } from "vitest";
import { stripSelfMarks } from "./botText";

describe("stripSelfMarks", () => {
  it("снимает «(я)» везде, где оно встретилось в тексте", () => {
    expect(stripSelfMarks("Доброе утро, Кирилл Кучеренко (я).")).toBe("Доброе утро, Кирилл Кучеренко.");
    expect(stripSelfMarks("• Смета — Кирилл Кучеренко (я) (срок был 6 дн. назад)")).toBe("• Смета — Кирилл Кучеренко (срок был 6 дн. назад)");
    expect(stripSelfMarks("Кирилл Кучеренко (я), Игорь")).toBe("Кирилл Кучеренко, Игорь");
  });

  it("не трогает обычный текст", () => {
    expect(stripSelfMarks("Смета (черновик) — я сделал")).toBe("Смета (черновик) — я сделал");
  });
});
