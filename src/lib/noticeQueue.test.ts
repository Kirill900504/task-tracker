import { describe, it, expect } from "vitest";
import { composeDigest, planFlush } from "./noticeQueue";

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

// 14.10.2026, снимок Кирилла: «не может выполнить» и ниже «написали в
// обсуждении» — один человек, одна задача с названием в десять строк,
// дважды. «Зачем ты ниже ещё добавляешь НАПИСАЛИ В ОБСУЖДЕНИИ… бред».
describe("один человек по одной задаче — одна строка", () => {
  const LONG = "Большая большая мобильная тестовая задача траааааааааааааааааааааааа ".repeat(8).trim();
  const r = (kind: string, what: string, who = "Кирилл (тест)") => ({ kind, who, item: LONG, item_id: "t1", item_number: 85, what });

  it("реплика того же человека в той же задаче приклеивается к ответу", () => {
    const text = composeDigest([r("declined", "Не успеваю из-за других задач"), r("comment", "123123123")]);
    expect(text).not.toContain("Написали в обсуждении");
    expect(text).not.toContain("РОКАС ·");
    expect(text).toContain("Не успеваю из-за других задач");
    expect(text).toContain("💬 123123123");
    expect(text.match(/Большая/g)).toHaveLength(1);
  });

  it("реплика, повторяющая ответ, пропадает вовсе", () => {
    const text = composeDigest([r("declined", "Не успеваю"), r("comment", "Не успеваю")]);
    expect(text.match(/Не успеваю/g)).toHaveLength(1);
    expect(text).not.toContain("💬");
  });

  it("подпись к документам ответа читается как «приложены документы»", () => {
    const text = composeDigest([r("declined", "Нет данных"), r("comment", "Документы к отказу")]);
    expect(text).toContain("📎 приложены документы");
    expect(text).not.toContain("Документы к отказу");
  });

  it("задача названа номером и коротким названием", () => {
    const text = composeDigest([r("declined", "Нет данных")]);
    expect(text).toContain("#85 «Большая");
    expect(text).toContain("…»");
    expect(text.length).toBeLessThan(200);
  });

  it("«не могу» кнопкой и причина следом — одна строка с причиной", () => {
    // Бот спрашивает причину вторым сообщением, и каждое из двух клало
    // своё событие.
    const text = composeDigest([r("accepted", ""), r("declined", ""), r("declined", "Нет доступа")]);
    expect(text).not.toContain("Приняли в работу");
    expect(text.match(/Кирилл/g)).toHaveLength(1);
    expect(text).toContain("Нет доступа");
  });

  it("«отчитались все» не теряется, когда следом приходят слова отчёта", () => {
    const text = composeDigest([r("reported_all", ""), r("reported", "Свёл цифры"), { ...r("declined", "x", "Игорь"), item_id: "t2", item: "Другая" }]);
    expect(text).toContain("Ждут вашей приёмки (1)");
    expect(text).not.toContain("Отчитались о своей части");
    expect(text).toContain("Свёл цифры");
  });

  it("чужие реплики и реплики по другим задачам остаются своей группой", () => {
    const text = composeDigest([r("declined", "Нет данных"), r("comment", "Помогу", "Игорь"), { ...r("comment", "По другой"), item_id: "t2", item: "Другая" }]);
    expect(text).toContain("Написали в обсуждении (2)");
  });

  it("несколько реплик одного человека в одном обсуждении — одна строка", () => {
    const text = composeDigest([r("comment", "раз"), r("comment", "два"), { ...r("declined", "x", "Игорь"), item_id: "t2" }]);
    expect(text).toContain("Написали в обсуждении (1)");
    expect(text).toContain("раз");
    expect(text).toContain("💬 два");
  });
});

// 13.10.2026, отзыв Витковского: «принял в работу» приходило отдельным
// сообщением через пять минут после нажатия.
describe("события без решения не шлются отдельным письмом", () => {
  const now = new Date("2026-10-13T12:00:00Z").getTime();
  const q = (kind: string, hoursAgo: number) => ({ kind, created_at: new Date(now - hoursAgo * 3600_000).toISOString() });

  it("одно «принял в работу» ждёт и не уходит", () => {
    expect(planFlush([q("accepted", 0.1)], now)).toEqual({ send: [], drop: [] });
    expect(planFlush([q("vote_yes", 1), q("idea_taken", 2)], now).send).toEqual([]);
  });

  it("уходит попутчиком письма, в котором есть что решать", () => {
    const list = [q("accepted", 3), q("reported_all", 0.1)];
    expect(planFlush(list, now).send).toEqual(list);
  });

  it("не дождавшийся письма снимается через сутки молча", () => {
    const old = q("accepted", 25);
    expect(planFlush([old, q("vote_yes", 1)], now)).toEqual({ send: [], drop: [old] });
  });
});
