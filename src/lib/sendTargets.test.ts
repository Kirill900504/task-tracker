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

  it("never offers to send to yourself", () => {
    expect(sendTargets(["Кирилл (я)", "Аня"], ["Кирилл (я)"])).toEqual([{ name: "Аня", suggested: false }]);
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

  it("does not count the owner as unreachable", () => {
    expect(unreachableNames(["Аня"], ["Кирилл (я)"])).toEqual([]);
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
