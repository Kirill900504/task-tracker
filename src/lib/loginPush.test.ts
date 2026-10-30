import { describe, expect, it } from "vitest";
import { nameMatches } from "./loginPush";

// Вход запросом в мессенджер ищет человека по фамилии (lib/loginPush):
// целыми словами, без регистра и «ё», мимо пометки «(я)».
describe("поиск человека по имени для входа", () => {
  it("фамилия и «Имя Фамилия» находят строку, в том числе владельца", () => {
    expect(nameMatches("Кирилл Кучеренко (я)", "кучеренко")).toBe(true);
    expect(nameMatches("Кирилл Кучеренко (я)", " Кирилл  Кучеренко ")).toBe(true);
    expect(nameMatches("Пётр Семёнов", "семенов")).toBe(true);
    expect(nameMatches("Михаил Котов", "Котов Михаил")).toBe(true);
  });

  it("часть слова, чужая фамилия и одна пометка не находят никого", () => {
    expect(nameMatches("Кирилл Кучеренко (я)", "Кучер")).toBe(false);
    expect(nameMatches("Кирилл Кучеренко (я)", "Кирилл Котов")).toBe(false);
    expect(nameMatches("Кирилл Кучеренко (я)", "(я)")).toBe(false);
  });
});
