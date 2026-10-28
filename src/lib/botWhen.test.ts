import { describe, expect, it } from "vitest";
import { dayLabel, moveChoices, parseWhen } from "@/lib/botWhen";

// Вторник, 20.10.2026 — день, когда Кирилл прислал снимки с четырьмя
// неудачными просьбами перенести одну встречу.
const TODAY = "2026-10-20";

describe("parseWhen — фразы со снимков 19.10.2026", () => {
  it("«на следующий понедельник» — понедельник 26.10", () => {
    expect(parseWhen("Перенеси эту встречу на следующий понедельник", TODAY).date).toBe("2026-10-26");
  });
  it("«На 26.10» и просто «26.10»", () => {
    expect(parseWhen("На 26.10", TODAY).date).toBe("2026-10-26");
    expect(parseWhen("26.10", TODAY).date).toBe("2026-10-26");
  });
  it("«Перенести на 26 октября телемост»", () => {
    expect(parseWhen("Перенести на 26 октября телемост", TODAY).date).toBe("2026-10-26");
  });
  it("«на 26.10 на это же время» — дата и прежнее время", () => {
    const when = parseWhen("Перенеси на 26.10 на это же время", TODAY);
    expect(when.date).toBe("2026-10-26");
    expect(when.time).toBe("");
    expect(when.sameTime).toBe(true);
  });
  it("«на неделю» сдвигает от даты самой встречи, даже вчерашней", () => {
    expect(parseWhen("Перенеси на неделю", TODAY, "2026-10-19").date).toBe("2026-10-26");
    expect(parseWhen("на неделю", TODAY, "2026-10-29").date).toBe("2026-11-05");
    // Встреча месячной давности: от неё неделя всё ещё в прошлом.
    expect(parseWhen("на неделю", TODAY, "2026-09-01").date).toBe("2026-10-27");
  });
});

describe("parseWhen — время", () => {
  it("двоеточие — время, а не дата", () => {
    expect(parseWhen("завтра в 15:30", TODAY)).toEqual({ date: "2026-10-21", time: "15:30", sameTime: false });
  });
  it("«в 10.30» — время, «10.11» — дата", () => {
    expect(parseWhen("в 10.30", TODAY)).toMatchObject({ date: "", time: "10:30" });
    expect(parseWhen("10.11", TODAY)).toMatchObject({ date: "2026-11-10", time: "" });
  });
  // 28.10.2026: «на 03.11 в то же время» читалось как 03:11 — и встреча
  // уезжала на 31.10 в три часа ночи.
  it("«на 03.11» — дата, а не 03:11; «на 10.30» — время", () => {
    expect(parseWhen("Перенеси телемост на 03.11 в то же время", TODAY)).toEqual({ date: "2026-11-03", time: "", sameTime: true });
    expect(parseWhen("на 10.30", TODAY)).toMatchObject({ date: "", time: "10:30" });
    expect(parseWhen("на 05.11 в 10.30", TODAY)).toMatchObject({ date: "2026-11-05", time: "10:30" });
  });
  it("«на 15 часов»", () => {
    expect(parseWhen("на 15 часов", TODAY).time).toBe("15:00");
  });
});

describe("parseWhen — слова и дни недели", () => {
  it("завтра, послезавтра, сегодня", () => {
    expect(parseWhen("завтра", TODAY).date).toBe("2026-10-21");
    expect(parseWhen("послезавтра", TODAY).date).toBe("2026-10-22");
    expect(parseWhen("сегодня", TODAY).date).toBe(TODAY);
  });
  it("день недели — ближайший после сегодняшнего", () => {
    expect(parseWhen("в среду", TODAY).date).toBe("2026-10-21");
    expect(parseWhen("на вторник", TODAY).date).toBe("2026-10-27");
    expect(parseWhen("к пятнице", TODAY).date).toBe("2026-10-23");
  });
  it("«через две недели», «через 3 дня»", () => {
    expect(parseWhen("через две недели", TODAY).date).toBe("2026-11-03");
    expect(parseWhen("через 3 дня", TODAY).date).toBe("2026-10-23");
  });
  it("число без года, уже прошедшее, — следующий год", () => {
    expect(parseWhen("05.01", TODAY).date).toBe("2027-01-05");
    expect(parseWhen("31.02", TODAY).date).toBe("");
  });
  it("слово не по делу — ничего", () => {
    expect(parseWhen("только телемост", TODAY)).toEqual({ date: "", time: "", sameTime: false });
  });
});

describe("кнопки переноса", () => {
  it("подпись с днём недели", () => {
    expect(dayLabel("2026-10-26")).toBe("пн 26.10");
  });
  it("в пятницу «завтра» ведёт на понедельник и не называется «завтра»", () => {
    const choices = moveChoices("2026-10-23", "2026-10-23");
    expect(choices.map((c) => c.date)).toEqual(["2026-10-26", "2026-10-30"]);
    expect(choices[0].label).toBe("пн 26.10");
    expect(choices[1].label).toBe("+неделя · пт 30.10");
  });
  it("прежняя дата и прошлое не предлагаются", () => {
    const choices = moveChoices(TODAY, "2026-10-21");
    expect(choices.some((c) => c.date === "2026-10-21" || c.date <= TODAY)).toBe(false);
  });
});
