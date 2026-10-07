import { describe, it, expect } from "vitest";
import { buildIcs, calendarToken, verifyCalendarToken } from "./calendarFeed";

// Ссылка на календарь — пароль к расписанию человека. Поэтому проверяется
// подделками, а не только честной ссылкой (урок мини-приложения: проверка
// подписи, испытанная только своей подписью, не испытана).
describe("ссылка на календарь", () => {
  const secret = "s3cret";
  const me = "11111111-1111-1111-1111-111111111111";
  const other = "22222222-2222-2222-2222-222222222222";

  it("своя ссылка узнаёт своего человека — с .ics и без", () => {
    const t = calendarToken(me, secret);
    expect(verifyCalendarToken(t, secret)).toBe(me);
    expect(verifyCalendarToken(t + ".ics", secret)).toBe(me);
  });

  it("чужой id под своей подписью — отказ", () => {
    const sig = calendarToken(me, secret).split(".").pop();
    expect(verifyCalendarToken(`${other}.${sig}`, secret)).toBeNull();
  });

  it("подпись другим секретом — отказ", () => {
    expect(verifyCalendarToken(calendarToken(me, "другой"), secret)).toBeNull();
  });

  it("мусор — отказ, а не исключение", () => {
    for (const t of ["", ".", "abc", `${me}.`, `${me}.короткая`]) expect(verifyCalendarToken(t, secret)).toBeNull();
  });
});

describe("файл календаря", () => {
  const now = new Date("2026-10-07T09:00:00Z");
  const ics = buildIcs(
    [
      { id: "m1", title: "Планёрка, отдел; продаж", date: "2026-10-08", time: "10:30", durationMin: 60, participants: ["Аня", "Борис"], status: "planned" },
      { id: "m2", title: "Без времени", date: "2026-10-09", time: null, durationMin: null, participants: [], status: "proposed" },
    ],
    now,
  );

  it("время — московское, конец считается из длительности", () => {
    expect(ics).toContain("DTSTART;TZID=Europe/Moscow:20261008T103000");
    expect(ics).toContain("DTEND;TZID=Europe/Moscow:20261008T113000");
  });

  it("встреча без времени — на весь день, предложенная — под вопросом", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20261009");
    expect(ics).toMatch(/UID:m2@rokas-tracker[\s\S]*STATUS:TENTATIVE/);
  });

  it("запятая и точка с запятой экранируются, напоминание за 15 минут есть", () => {
    expect(ics).toContain("SUMMARY:Планёрка\\, отдел\\; продаж");
    expect(ics).toContain("TRIGGER:-PT15M");
  });

  it("строки не длиннее 75 байт и разделены CRLF", () => {
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });
});
