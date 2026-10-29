import { describe, expect, it } from "vitest";
import { normalizePhone, phoneHref } from "./phone";

describe("рабочий телефон", () => {
  it("российский номер в любом написании приходит к одному виду", () => {
    for (const raw of ["8 (900) 123 45 67", "+79001234567", "9001234567", "+7 900 123-45-67", "8-900-123-45-67"]) {
      expect(normalizePhone(raw)).toBe("+7 900 123-45-67");
    }
  });

  it("пустое поле — стереть номер, а не ошибка", () => {
    expect(normalizePhone("   ")).toBe("");
  });

  it("иностранный номер сохраняется цифрами с плюсом", () => {
    expect(normalizePhone("+375 29 123-45-67")).toBe("+375291234567");
  });

  it("слова и обрывки номером не считаются", () => {
    expect(normalizePhone("позвоните мне")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });

  it("ссылка для набора — без пробелов и скобок", () => {
    expect(phoneHref("+7 900 123-45-67")).toBe("tel:+79001234567");
  });
});
