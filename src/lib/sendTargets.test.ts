import { describe, expect, it } from "vitest";
import { sendResultText, sendTargets, unreachableNames } from "./sendTargets";

describe("sendTargets", () => {
  it("puts the people the item concerns first", () => {
    expect(sendTargets(["Аня", "Борис", "Вера"], ["Вера"])).toEqual([
      { name: "Вера", suggested: true },
      { name: "Аня", suggested: false },
      { name: "Борис", suggested: false },
    ]);
  });

  it("still offers everyone when the assignee is not in a messenger", () => {
    expect(sendTargets(["Аня"], ["Борис"])).toEqual([{ name: "Аня", suggested: false }]);
  });

  // Себя в этом списке нет, потому что его нет уже во входных данных:
  // свою строку снимает useColleagues — и снимает именно СВОЮ. Здесь же
  // фильтр стоял по метке «(я)», то есть вычёркивал владельца у всех
  // остальных: руководитель не мог отправить ему ни мысль, ни встречу.
  it("отдаёт владельца как обычного адресата — снимает себя тот, кто знает, кто я", () => {
    expect(sendTargets(["Кирилл (я)", "Аня"], ["Кирилл (я)"])).toEqual([
      { name: "Кирилл (я)", suggested: true },
      { name: "Аня", suggested: false },
    ]);
  });

  // Раньше эта половина списка шла в том порядке, в каком люди записаны во
  // встрече. Теперь — в общем порядке людей (peopleOrder.ts): Кирилл
  // попросил один порядок на все списки трекера, и «кого это касается»
  // остаётся наверху, но читается так же, как везде.
  it("keeps every participant of a meeting suggested, in the tracker's own order", () => {
    expect(sendTargets(["Аня", "Борис"], ["Борис", "Аня"]).map((t) => t.name)).toEqual(["Аня", "Борис"]);
  });

  it("has nothing to offer when nobody is connected", () => {
    expect(sendTargets([], ["Аня"])).toEqual([]);
  });
});

describe("unreachableNames", () => {
  it("names the addressees who are in no messenger", () => {
    expect(unreachableNames(["Аня"], ["Аня", "Борис"])).toEqual(["Борис"]);
  });

  // Владелец достижим — просто его чат живёт не в строке, а в учётной
  // записи (lib/reach), и `linked` для него ставит useColleagues.
  it("владелец, которого касается итем, считается достижимым", () => {
    expect(unreachableNames(["Аня", "Кирилл (я)"], ["Кирилл (я)"])).toEqual([]);
  });
});

describe("sendResultText", () => {
  it("reports what arrived and what did not", () => {
    expect(sendResultText({ sentTo: ["Аня"], failed: ["Борис (заблокировал бота)"] })).toBe(
      "Отправлено: Аня; не дошло: Борис (заблокировал бота)",
    );
    expect(sendResultText({ sentTo: ["Аня"], failed: [] })).toBe("Отправлено: Аня");
    expect(sendResultText({ sentTo: [], failed: ["Аня"] })).toBe("Не дошло: Аня");
    expect(sendResultText({ sentTo: [], failed: [] })).toBe("Некому отправлять");
  });
});
