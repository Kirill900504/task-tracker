import { describe, expect, it } from "vitest";
import { authorLabel } from "./authorName";

const PEOPLE = ["Игорь Витковский", "Кирилл Кучеренко (я)", "Никита Козлов"];
const AUTHORS = { "a02f-igor": "Игорь Витковский", "64db-evg": "Евгений Макаров (я)" };

describe("authorLabel", () => {
  it("пустой created_by — это владелец, а не «никто»", () => {
    expect(authorLabel("", AUTHORS, PEOPLE)).toBe("Кирилл Кучеренко");
    expect(authorLabel(undefined, AUTHORS, PEOPLE)).toBe("Кирилл Кучеренко");
  });

  it("называет руководителя по имени", () => {
    expect(authorLabel("a02f-igor", AUTHORS, PEOPLE)).toBe("Игорь Витковский");
  });

  it("снимает пометку «(я)»: карточку читают все, а написана она для одного", () => {
    expect(authorLabel("64db-evg", AUTHORS, PEOPLE)).toBe("Евгений Макаров");
  });

  it("логин без имени — человек, которого убрали из трекера, а не пустое место", () => {
    expect(authorLabel("кто-то-ушедший", AUTHORS, PEOPLE)).toBe("бывший участник");
  });

  it("не падает, когда строки владельца в списке ещё нет", () => {
    expect(authorLabel("", AUTHORS, ["Игорь Витковский"])).toBe("владелец");
  });
});
