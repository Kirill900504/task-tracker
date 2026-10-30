import { describe, expect, it } from "vitest";
import { isBarePhonePrefix, normalizePhone, phoneHref, typePhone } from "./phone";

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

  it("поле при наборе: 8 и голая десятка становятся +7, вставка поверх «+7 » тоже", () => {
    expect(typePhone("8")).toBe("+7");
    expect(typePhone("+7 8")).toBe("+7 8");
    expect(typePhone("89897201133")).toBe("+7 989 720-11-33");
    expect(typePhone("+7 89897201133", "+7 ")).toBe("+7 989 720-11-33");
    expect(typePhone("+7 +79897201133", "+7 ")).toBe("+7 989 720-11-33");
    expect(typePhone("+7 9897201133", "+7 ")).toBe("+7 989 720-11-33");
    expect(typePhone("9897201133")).toBe("+7 989 720-11-33");
    expect(typePhone("+7 989 720-11-339", "+7 989 720-11-33")).toBe("+7 989 720-11-33");
    expect(typePhone("+7 800 123-45-679", "+7 800 123-45-67")).toBe("+7 800 123-45-67");
    expect(typePhone("+7 9897")).toBe("+7 989 7");
    expect(typePhone("+")).toBe("");
    expect(typePhone("+375 29")).toBe("+375 29");
    for (const raw of ["89897201133", "+7 9897201133"]) {
      expect(normalizePhone(typePhone(raw))).toBe("+7 989 720-11-33");
    }
  });

  it("одна приставка «+7 » номером не считается", () => {
    expect(isBarePhonePrefix("+7 ")).toBe(true);
    expect(isBarePhonePrefix("+7 9")).toBe(false);
  });

  it("ссылка для набора — без пробелов и скобок", () => {
    expect(phoneHref("+7 900 123-45-67")).toBe("tel:+79001234567");
  });
});
