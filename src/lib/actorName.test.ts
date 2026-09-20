import { describe, it, expect } from "vitest";
import { withoutSelfMark } from "./actorName";

// «(я)» — пометка в списке людей, а не часть имени. Она уезжала в
// мессенджер («Кирилл (я): сделайте до пятницы») и в подпись под репликой
// в чужой карточке; там её читает кто угодно, кроме того, для кого она
// написана.

describe("withoutSelfMark", () => {
  it("снимает пометку со своей строки", () => {
    expect(withoutSelfMark("Кирилл (я)")).toBe("Кирилл");
    expect(withoutSelfMark("Кирилл (я) ")).toBe("Кирилл");
  });

  it("не трогает чужие имена и скобки внутри имени", () => {
    expect(withoutSelfMark("Игорь Витковский")).toBe("Игорь Витковский");
    expect(withoutSelfMark("Михаил (Котов) Иванов")).toBe("Михаил (Котов) Иванов");
  });

  it("пустое остаётся пустым — вызывающий подставит своё слово", () => {
    expect(withoutSelfMark("")).toBe("");
    expect(withoutSelfMark("(я)")).toBe("");
  });
});
