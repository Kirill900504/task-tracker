import { describe, expect, it } from "vitest";
import { byPrefix, dayByOffset, freeSlots, isIdeaInboxAction, meetingDays, personRef, splitRef } from "@/lib/ideaInbox";
import { decodeCallback, encodeCallback, ideaButtons } from "@/lib/colleagues";

// Москва = UTC+3; moscowNow() отдаёт дату, чьи UTC-поля читаются как
// московское время. Так же строятся «сейчас» в этих тестах.
function msk(iso: string): Date {
  return new Date(iso + "Z");
}

describe("кнопки получателя мысли", () => {
  it("влезают в 64 байта Telegram на самом длинном шаге", () => {
    const ideaId = "0f8b6c1e-9d2a-4b7e-8c3f-1a2b3c4d5e6f";
    const person = "a1b2c3d4-0000-4000-8000-000000000000";
    const longest = [
      encodeCallback("idea", "~tg", `${ideaId}.${personRef(person)}.fri`),
      encodeCallback("idea", "~mt", `${ideaId}.12.1830`),
    ];
    for (const data of longest) expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
  });

  it("разбираются модулем мысли, а свои кнопки владельца — нет", () => {
    for (const b of ideaButtons("i1").flat()) expect(isIdeaInboxAction(decodeCallback(b.data)!)).toBe(true);
    // «В задачу» и «Вычеркнуть» в списке СВОИХ мыслей — постановщицкие.
    expect(isIdeaInboxAction(decodeCallback("i:itask:i1")!)).toBe(false);
    expect(isIdeaInboxAction(decodeCallback("i:idone:i1")!)).toBe(false);
  });

  it("несут шаги в хвосте кнопки", () => {
    expect(splitRef("abc.me")).toEqual(["abc", "me"]);
    expect(splitRef("abc.12345678.fri")).toEqual(["abc", "12345678", "fri"]);
  });
});

describe("byPrefix — человек по началу id", () => {
  const people = [{ id: "aaaa1111-x" }, { id: "bbbb2222-y" }, { id: "bbbb2222-z" }];

  it("находит единственного", () => {
    expect(byPrefix(people, "aaaa1111")?.id).toBe("aaaa1111-x");
  });

  it("отказывает, когда префикс неоднозначен — не угадывает", () => {
    expect(byPrefix(people, "bbbb2222")).toBeNull();
  });

  it("отказывает пустому и несуществующему", () => {
    expect(byPrefix(people, "")).toBeNull();
    expect(byPrefix(people, "cccc")).toBeNull();
  });
});

describe("meetingDays — какие дни предложить", () => {
  it("пропускает выходные и считает по Москве", () => {
    // Пятница 09.10.2026, 10:00 по Москве.
    const days = meetingDays(msk("2026-10-09T10:00:00"), 3);
    expect(days.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-12", "2026-10-13"]);
    expect(days[0]).toMatchObject({ offset: 0, date: "2026-10-09", label: "Сегодня" });
    // Суббота и воскресенье пропущены — дальше понедельник.
    expect(days[1].date).toBe("2026-10-12");
    expect(days[1].label).toBe("Пн 12.10");
  });

  it("не предлагает сегодня, когда рабочий день кончился", () => {
    // Четверг 08.10.2026, 18:30 — последний слот 18:00 уже начался.
    const days = meetingDays(msk("2026-10-08T18:30:00"), 2);
    expect(days[0]).toMatchObject({ date: "2026-10-09", label: "Завтра" });
  });

  it("смещение дня переводится в дату по Москве", () => {
    // 22:30 по UTC 07.10 — в Москве уже 08.10, 01:30.
    expect(dayByOffset(0, msk("2026-10-08T01:30:00"))).toBe("2026-10-08");
    expect(dayByOffset(1, msk("2026-10-08T01:30:00"))).toBe("2026-10-09");
  });
});

describe("freeSlots — свободное время", () => {
  it("убирает прошедшее и занятое", () => {
    const free = freeSlots("2026-10-08", new Set(["15:00"]), msk("2026-10-08T14:10:00"));
    expect(free[0]).toBe("14:30");
    expect(free).not.toContain("14:00");
    expect(free).not.toContain("15:00");
    expect(free).toContain("15:30");
  });

  it("на другой день предлагает весь рабочий день", () => {
    const free = freeSlots("2026-10-09", new Set(), msk("2026-10-08T14:10:00"));
    expect(free[0]).toBe("09:00");
    expect(free[free.length - 1]).toBe("18:00");
  });
});
