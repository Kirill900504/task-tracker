import { describe, it, expect } from "vitest";
import { nextWeekdayMap, sanitizeAgainstKnown, resolveKnownName, nameWasSaid, mergeDuplicateItems, type QuickAddItem } from "./quickAdd";
import { isoDate, addDays } from "./whenDate";

describe("isoDate / addDays", () => {
  it("formats using local calendar fields (not UTC)", () => {
    const d = new Date(2026, 8, 2); // 2026-09-02, local time, no UTC conversion
    expect(isoDate(d)).toBe("2026-09-02");
  });

  it("adds days without rolling over incorrectly at month boundaries", () => {
    const d = new Date(2026, 8, 29); // 2026-09-29
    expect(isoDate(addDays(d, 3))).toBe("2026-10-02");
  });
});

describe("nextWeekdayMap", () => {
  // Regression test: GigaChat's free-tier model got "in Friday" wrong even
  // with a full 14-day calendar in the prompt (computed 2026-09-08, a
  // Tuesday, when the correct next Friday from Wed 2026-09-02 was
  // 2026-09-04). Handing over an explicit weekday->date map fixed it in
  // manual testing — this test locks in that the map itself is correct.
  it("maps each weekday name to its correct next occurrence, from a Wednesday", () => {
    const now = new Date(2026, 8, 2); // Wednesday 2026-09-02
    const map = nextWeekdayMap(now);
    const lines = map.split("\n");
    const asObj = Object.fromEntries(lines.map((l) => l.split(" → ")));

    expect(asObj["среда"]).toBe("2026-09-02"); // today
    expect(asObj["четверг"]).toBe("2026-09-03"); // tomorrow
    expect(asObj["пятница"]).toBe("2026-09-04"); // the bug case
    expect(asObj["суббота"]).toBe("2026-09-05");
    expect(asObj["воскресенье"]).toBe("2026-09-06");
    expect(asObj["понедельник"]).toBe("2026-09-07");
    expect(asObj["вторник"]).toBe("2026-09-08");
  });

  it("never maps a weekday to a date more than 6 days out", () => {
    const now = new Date(2026, 8, 2);
    const map = nextWeekdayMap(now);
    for (const line of map.split("\n")) {
      const [, iso] = line.split(" → ");
      const [y, m, d] = iso.split("-").map(Number);
      const local = new Date(y, m - 1, d); // parse as local, same anchor as `now`
      const diffDays = (local.getTime() - now.getTime()) / 86_400_000;
      expect(diffDays).toBeGreaterThanOrEqual(0);
      expect(diffDays).toBeLessThanOrEqual(6);
    }
  });
});

describe("sanitizeAgainstKnown", () => {
  const known = ["Кирилл (я)", "Юрий Черкашин"];

  it("clears an assignee that isn't an exact match, and reports it as dropped", () => {
    const input: Record<string, unknown> = { assignee: "Иван" };
    const dropped = sanitizeAgainstKnown(input, known);
    expect(input.assignee).toBe("");
    expect(dropped).toEqual(["Иван"]);
  });

  it("keeps an assignee that exactly matches the known list, reports nothing dropped", () => {
    const input: Record<string, unknown> = { assignee: "Юрий Черкашин" };
    const dropped = sanitizeAgainstKnown(input, known);
    expect(input.assignee).toBe("Юрий Черкашин");
    expect(dropped).toEqual([]);
  });

  it("filters out participants not in the known list, keeps the rest, reports the dropped one", () => {
    const input: Record<string, unknown> = { participants: ["Кирилл (я)", "Придуманное Имя"] };
    const dropped = sanitizeAgainstKnown(input, known);
    expect(input.participants).toEqual(["Кирилл (я)"]);
    expect(dropped).toEqual(["Придуманное Имя"]);
  });

  it("cleans the second executor of a shared task the same way as a participant", () => {
    const input: Record<string, unknown> = { assignee: "Юрий Черкашин", executors: ["Кирилл (я)", "Кто-то Ещё"] };
    const dropped = sanitizeAgainstKnown(input, known);
    expect(input.executors).toEqual(["Кирилл (я)"]);
    expect(dropped).toEqual(["Кто-то Ещё"]);
  });

  it("never lists the assignee twice — one person, one row of participation", () => {
    const input: Record<string, unknown> = { assignee: "Юрий Черкашин", executors: ["Юрий Черкашин", "Кирилл (я)"] };
    sanitizeAgainstKnown(input, known);
    expect(input.executors).toEqual(["Кирилл (я)"]);
  });
});

describe("nameWasSaid", () => {
  it("recognises a name from a matching word in the phrase, even a different case ending", () => {
    expect(nameWasSaid("Никита Козлов", "поручи Никите Козлову смету")).toBe(true);
  });

  it("says false when the name was never mentioned", () => {
    expect(nameWasSaid("Игорь Витковский", "поручи Никите смету")).toBe(false);
  });

  it("says false when the phrase is empty — nothing was heard to compare against", () => {
    expect(nameWasSaid("Игорь Витковский", "")).toBe(false);
  });
});

describe("resolveKnownName", () => {
  const KNOWN = ["Кирилл (я)", "Игорь Витковский", "Наталья Мамакова", "Никита Козлов", "Юрий Нодберг"];

  it("keeps a name that is already exactly right", () => {
    expect(resolveKnownName("Никита Козлов", KNOWN)).toBe("Никита Козлов");
  });

  it("resolves a first name on its own", () => {
    expect(resolveKnownName("Игорь", KNOWN)).toBe("Игорь Витковский");
  });

  it("resolves a surname on its own", () => {
    expect(resolveKnownName("Мамакова", KNOWN)).toBe("Наталья Мамакова");
  });

  it("resolves an inflected name", () => {
    expect(resolveKnownName("Никите Козлову", KNOWN)).toBe("Никита Козлов");
  });

  it("resolves «Кирилл» to the entry with the parenthetical", () => {
    expect(resolveKnownName("Кирилл", KNOWN)).toBe("Кирилл (я)");
  });

  it("refuses to guess when a fragment fits two people", () => {
    expect(resolveKnownName("Игорь", [...KNOWN, "Игорь Петров"])).toBeNull();
  });

  it("returns null for someone not on the list at all", () => {
    expect(resolveKnownName("Сергей Иванов", KNOWN)).toBeNull();
  });
});

describe("sanitizeAgainstKnown with partial names", () => {
  const KNOWN = ["Игорь Витковский", "Наталья Мамакова"];

  it("fills in the full name of an assignee given by first name", () => {
    const input: Record<string, unknown> = { assignee: "Игорь" };
    expect(sanitizeAgainstKnown(input, KNOWN)).toEqual([]);
    expect(input.assignee).toBe("Игорь Витковский");
  });

  it("expands participants and reports only the genuinely unknown ones", () => {
    const input: Record<string, unknown> = { participants: ["Наталья", "Пётр Сидоров"] };
    expect(sanitizeAgainstKnown(input, KNOWN)).toEqual(["Пётр Сидоров"]);
    expect(input.participants).toEqual(["Наталья Мамакова"]);
  });

  it("does not list the same person twice", () => {
    const input: Record<string, unknown> = { participants: ["Игорь", "Витковский"] };
    sanitizeAgainstKnown(input, KNOWN);
    expect(input.participants).toEqual(["Игорь Витковский"]);
  });
});

describe("mergeDuplicateItems — одна вещь, названная дважды", () => {
  const task = (input: Record<string, unknown>): QuickAddItem => ({ tool: "create_task", input, droppedNames: [] });

  it("ответ 14.09.2026: две задачи с одним названием на двух людей — одна задача на обоих", () => {
    // Ровно то, что модель вернула на «создай ещё одну задачу на Игоря…
    // назначь исполнителя Никита Козлов» (журнал: «create_task, create_task»).
    const out = mergeDuplicateItems([
      task({ title: "Тестовая задача для закрытия", description: "четыре раза слово Кирилл", assignee: "Игорь Витковский", executors: [], deadline: "2026-10-01" }),
      task({ title: "тестовая задача для закрытия", description: "", assignee: "Никита Козлов", executors: [], deadline: "" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].input.assignee).toBe("Игорь Витковский");
    expect(out[0].input.executors).toEqual(["Никита Козлов"]);
    expect(out[0].input.description).toBe("четыре раза слово Кирилл");
    expect(out[0].input.deadline).toBe("2026-10-01");
  });

  it("точный повтор — одна задача, без лишнего соисполнителя", () => {
    const one = { title: "поискать БАЗЫ клиентов!", assignee: "Евгений Макаров", executors: [], deadline: "2026-09-28" };
    const out = mergeDuplicateItems([task({ ...one }), task({ ...one, title: "Поискать базы клиентов" })]);
    expect(out).toHaveLength(1);
    expect(out[0].input.executors).toEqual([]);
  });

  it("у второй задачи взяты пустые у первой срок и исполнитель", () => {
    const out = mergeDuplicateItems([task({ title: "Смета", assignee: "", deadline: "" }), task({ title: "Смета", assignee: "Игорь", deadline: "2026-10-20" })]);
    expect(out[0].input.assignee).toBe("Игорь");
    expect(out[0].input.deadline).toBe("2026-10-20");
    expect(out[0].input.executors).toEqual([]);
  });

  it("разные задачи остаются разными, порядок сохранён", () => {
    const out = mergeDuplicateItems([task({ title: "Смета" }), task({ title: "Договор" }), task({ title: "Смета" })]);
    expect(out.map((i) => i.input.title)).toEqual(["Смета", "Договор"]);
  });

  it("встречи с одним названием в разные дни — две встречи; в один — одна со всеми", () => {
    const meet = (date: string, participants: string[]): QuickAddItem => ({ tool: "create_meeting", input: { title: "Планёрка", date, time: "10:00", participants }, droppedNames: [] });
    expect(mergeDuplicateItems([meet("2026-10-16", ["А"]), meet("2026-10-17", ["А"])])).toHaveLength(2);
    const same = mergeDuplicateItems([meet("2026-10-16", ["А"]), meet("2026-10-16", ["Б", "А"])]);
    expect(same).toHaveLength(1);
    expect(same[0].input.participants).toEqual(["А", "Б"]);
  });

  it("мысль, названная дважды, — одна; задача и мысль с одним текстом — две разные вещи", () => {
    const idea: QuickAddItem = { tool: "create_idea", input: { text: "Позвонить в банк", important: false }, droppedNames: [] };
    const out = mergeDuplicateItems([idea, { ...idea, input: { text: "позвонить в банк.", important: true } }, task({ title: "Позвонить в банк" })]);
    expect(out.map((i) => i.tool)).toEqual(["create_idea", "create_task"]);
    expect(out[0].input.important).toBe(true);
  });

  it("не трогает входной массив", () => {
    const first = task({ title: "Смета", assignee: "Игорь", executors: [] });
    mergeDuplicateItems([first, task({ title: "Смета", assignee: "Никита" })]);
    expect(first.input.executors).toEqual([]);
  });
});
