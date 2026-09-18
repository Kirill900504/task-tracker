import { describe, it, expect } from "vitest";
import { composeDigest } from "./noticeQueue";

const row = (kind: string, who: string, item: string, what = "") => ({ kind, who, item, what });

describe("сводка вместо ленты", () => {
  it("складывает десять сообщений в одно письмо", () => {
    // Снимок, который прислал Кирилл: шесть сообщений подряд, каждое про
    // своё. «Я офигею это всё читать и элементарно не смогу нормально
    // воспринимать».
    const text = composeDigest([
      row("accepted", "Никита Козлов", "2222222"),
      row("reported_all", "Игорь Витковский", "тесттесттест", "готово"),
      row("accepted", "Юрий Черкашин", "Смета"),
      row("declined", "Наталья Есина", "Остатки", "нет данных"),
    ]);
    expect(text).toContain("4 события");
    // Один заголовок на два «принял», а не два отдельных сообщения.
    expect(text).toContain("✅ Приняли в работу (2)");
    expect(text.match(/Приняли в работу/g)).toHaveLength(1);
  });

  it("сверху то, где ждут решения, а не то, что случилось раньше", () => {
    // Порядок групп — это и есть разница между сводкой и лентой: приёмка и
    // отказ требуют ответа, «принял» только сообщает.
    const text = composeDigest([
      row("accepted", "Никита", "А"),
      row("comment", "Игорь", "Б", "пришлю к вечеру"),
      row("reported_all", "Юрий", "В", "сделал"),
      row("declined", "Наталья", "Г", "нет данных"),
    ]);
    const at = (s: string) => text.indexOf(s);
    expect(at("Ждут вашей приёмки")).toBeLessThan(at("Не могут выполнить"));
    expect(at("Не могут выполнить")).toBeLessThan(at("Приняли в работу"));
    expect(at("Приняли в работу")).toBeLessThan(at("Написали в обсуждении"));
  });

  it("одно событие остаётся одной строкой", () => {
    // Заголовок «1 событие» и строка под ним читаются хуже, чем просто эта
    // строка: сводка из одного пункта — это сообщение с лишней шапкой.
    const text = composeDigest([row("declined", "Игорь", "Смета", "нет данных")]);
    expect(text).not.toContain("РОКАС ·");
    expect(text).not.toContain("(1)");
    expect(text).toContain("Игорь");
    expect(text).toContain("Смета");
    expect(text).toContain("нет данных");
  });

  it("длинную группу обрывает и называет остаток числом", () => {
    const many = Array.from({ length: 9 }, (_, i) => row("accepted", "Человек " + i, "Задача " + i));
    const text = composeDigest(many);
    expect(text).toContain("✅ Приняли в работу (9)");
    expect(text).toContain("…и ещё 3");
    expect(text).not.toContain("Человек 7");
  });

  it("в строке сначала человек, потом задача, потом его слова", () => {
    // Группа уже сказала, ЧТО произошло, поэтому список читается по именам —
    // по ним и ищут глазами.
    const text = composeDigest([row("reported", "Игорь Витковский", "Смета", "свёл цифры"), row("reported", "Никита", "Остатки", "готово")]);
    expect(text).toContain("• Игорь Витковский — «Смета»: свёл цифры");
  });

  it("пустая очередь не рождает письма", () => {
    expect(composeDigest([])).toBe("");
  });

  it("считает события по-русски", () => {
    expect(composeDigest([row("accepted", "А", "1"), row("accepted", "Б", "2")])).toContain("2 события");
    expect(composeDigest(Array.from({ length: 5 }, (_, i) => row("accepted", "Ч" + i, "З" + i)))).toContain("5 событий");
    expect(composeDigest(Array.from({ length: 21 }, (_, i) => row("accepted", "Ч" + i, "З" + i)))).toContain("21 событие");
  });
});
