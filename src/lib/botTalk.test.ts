import { describe, expect, test } from "vitest";
import { fallbackTalk, firstName, numberWordsToDigits, pulseFacts, talkIsSafe, talkKind } from "@/lib/botTalk";
import { TOOL_BY_TYPE, dropTalkBesideWork, type QuickAddItem } from "@/lib/quickAdd";

const busy = { todayTasks: 3, todayMeetings: 2, overdue: 1, nextMeeting: { time: "15:00", title: "Планёрка" } };
const empty = { todayTasks: 0, todayMeetings: 0, overdue: 0, nextMeeting: null };

describe("живой разговор: факты дня", () => {
  test("числа склоняются и ближайшая встреча названа", () => {
    expect(pulseFacts(busy)).toBe("2 встречи сегодня, ближайшая в 15:00 — «Планёрка», 3 задачи на сегодня, 1 просроченная задача");
  });

  test("пустой день — так и сказано, без нулей", () => {
    expect(pulseFacts(empty)).toBe("на сегодня ничего не запланировано и просрочек нет");
    expect(pulseFacts(null)).toBe("");
  });

  test("имя для обращения — первое слово без пометки «(я)»", () => {
    expect(firstName("Кирилл Кучеренко (я)")).toBe("Кирилл");
    expect(firstName("")).toBe("");
  });
});

// Сторож — единственное, что стоит между моделью и человеком: ответ,
// который назвал чужое число или выдуманную встречу, не уходит.
describe("живой разговор: сторож ответа модели", () => {
  const facts = pulseFacts(busy);

  test("тёплый ответ с фактами дня проходит", () => {
    expect(talkIsSafe("Доброе утро, Кирилл! Сегодня 2 встречи, ближайшая в 15:00 — «Планёрка». Начнём с просроченной?", facts)).toBe(true);
    expect(talkIsSafe("Пожалуйста! Обращайтесь 🙂", facts)).toBe(true);
  });

  test("выдуманное число не проходит", () => {
    expect(talkIsSafe("Привет! У вас сегодня 5 задач.", facts)).toBe(false);
  });

  // Живая модель 22.10.2026 писала числа словами: «две встречи и три
  // задачи». Цифровой сторож такое пропускал бы при любом числе.
  test("числа словами сверяются так же, как цифры", () => {
    expect(numberWordsToDigits("две встречи и три задачи, одна из них")).toBe("2 встречи и 3 задачи, одна из них");
    expect(talkIsSafe("Сегодня две встречи и три задачи.", facts)).toBe(true);
    expect(talkIsSafe("Сегодня пять встреч.", facts)).toBe(false);
  });

  test("выдуманная встреча не проходит", () => {
    expect(talkIsSafe("Привет! Не забудьте про «Встречу с банком».", facts)).toBe(false);
  });

  test("разметка, список, JSON и простыня не проходят", () => {
    expect(talkIsSafe("**Привет!**", facts)).toBe(false);
    expect(talkIsSafe("- первое\n- второе", facts)).toBe(false);
    expect(talkIsSafe('[{"type":"chat"}]', facts)).toBe(false);
    expect(talkIsSafe("Здравствуйте. ".repeat(40), facts)).toBe(false);
  });

  test("без фактов о делах не говорят цифрами", () => {
    expect(talkIsSafe("Привет! Сегодня 2 встречи.", "")).toBe(false);
    expect(talkIsSafe("Привет! Чем помочь?", "")).toBe(true);
  });
});

describe("живой разговор: заготовка, когда модель молчит", () => {
  test("вид реплики угадывается по словам", () => {
    expect(talkKind("Спасибо большое")).toBe("thanks");
    expect(talkKind("Доброе утро!")).toBe("greeting");
    expect(talkKind("устал, сегодня завал")).toBe("tired");
    expect(talkKind("пока, до завтра")).toBe("bye");
    expect(talkKind("ты кто?")).toBe("other");
  });

  test("приветствие называет день, усталость предлагает перенос", () => {
    expect(fallbackTalk("Привет", "Кирилл", busy)).toContain("Здравствуйте, Кирилл! На сегодня: 2 встречи");
    expect(fallbackTalk("устал", "", busy)).toContain("перенеси всё с сегодня на завтра");
    expect(fallbackTalk("спасибо", "", busy)).toMatch(/^Пожалуйста!/);
  });

  // Заготовка — тоже ответ, и сторож у неё тот же: она не может назвать
  // того, чего нет в фактах.
  test("заготовка проходит собственный сторож", () => {
    for (const phrase of ["привет", "спасибо", "устал", "пока", "как дела"]) {
      expect(talkIsSafe(fallbackTalk(phrase, "Кирилл", busy), pulseFacts(busy)), phrase).toBe(true);
    }
  });
});

describe("одна фраза — один ответ", () => {
  const item = (tool: string): QuickAddItem => ({ tool, input: {}, droppedNames: [] });

  test("тип chat разобран в инструмент разговора", () => {
    expect(TOOL_BY_TYPE.chat).toBe("small_talk");
  });

  test("«привет, что у меня сегодня?» — только вопрос", () => {
    expect(dropTalkBesideWork([item("small_talk"), item("answer_question")]).map((i) => i.tool)).toEqual(["answer_question"]);
  });

  test("живая реплика рядом с непонятым обрывком — только реплика", () => {
    expect(dropTalkBesideWork([item("cant_help"), item("small_talk")]).map((i) => i.tool)).toEqual(["small_talk"]);
  });

  test("одно непонятое остаётся непонятым", () => {
    expect(dropTalkBesideWork([item("cant_help")]).map((i) => i.tool)).toEqual(["cant_help"]);
  });
});
