import { describe, expect, it } from "vitest";
import { checkedButNotLinked, showCode } from "@/lib/messengerLink";

describe("код подключения", () => {
  it("исчезает, как только подключён его собственный канал", () => {
    expect(showCode("max", { telegram: false, max: false })).toBe(true);
    expect(showCode("max", { telegram: false, max: true })).toBe(false);
  });

  // Ровно тот случай со скриншота: MAX уже подключён, а блок с кодом MAX всё
  // ещё висит — и «Готово, проверить» честно проверяет и ничего не меняет.
  it("не остаётся висеть после успешного подключения", () => {
    expect(showCode("max", { telegram: false, max: true })).toBe(false);
  });

  it("чужое подключение его не убирает", () => {
    expect(showCode("telegram", { telegram: false, max: true })).toBe(true);
  });

  it("без выданного кода не показывается вовсе", () => {
    expect(showCode(null, { telegram: false, max: false })).toBe(false);
  });
});

describe("ответ на «Готово, проверить»", () => {
  it("молчит, когда канал подключился", () => {
    expect(checkedButNotLinked("max", { telegram: false, max: true })).toBe(false);
  });

  it("говорит «пока не вижу», когда нет", () => {
    expect(checkedButNotLinked("max", { telegram: true, max: false })).toBe(true);
  });

  it("общая кнопка «Проверить» смотрит на оба канала", () => {
    expect(checkedButNotLinked(null, { telegram: false, max: false })).toBe(true);
    expect(checkedButNotLinked(null, { telegram: false, max: true })).toBe(false);
  });
});
