import { describe, expect, it } from "vitest";
import { dueReminder, minutesUntil, ownerReminder, participantReminder } from "./meetingReminders";

describe("сколько осталось до встречи", () => {
  it("сегодняшняя считается по часам", () => {
    expect(minutesUntil("2026-09-09", 15 * 60, "2026-09-09", 13 * 60)).toBe(120);
  });

  it("завтрашняя — через полночь", () => {
    // Сейчас 18:00, встреча завтра в 10:00 → 16 часов.
    expect(minutesUntil("2026-09-10", 10 * 60, "2026-09-09", 18 * 60)).toBe(16 * 60);
  });

  it("послезавтрашняя ещё никого не касается", () => {
    expect(minutesUntil("2026-09-12", 10 * 60, "2026-09-09", 18 * 60)).toBeNull();
  });

  it("прошедшая сегодня уходит в минус", () => {
    expect(minutesUntil("2026-09-09", 9 * 60, "2026-09-09", 10 * 60)).toBe(-60);
  });
});

describe("какое напоминание пора слать", () => {
  it("за сутки — тем, кто ещё не ответил", () => {
    const w = dueReminder(24 * 60 - 3);
    expect(w?.kind).toBe("meeting_24h");
    expect(w?.audience).toBe("unanswered");
  });

  it("за два часа — тоже вопрос, а не напоминание", () => {
    expect(dueReminder(118)?.kind).toBe("meeting_2h");
    expect(dueReminder(118)?.audience).toBe("unanswered");
  });

  it("за полчаса и за четверть часа — тем, кто придёт", () => {
    expect(dueReminder(28)?.kind).toBe("meeting_30m");
    expect(dueReminder(14)?.kind).toBe("meeting_soon");
    expect(dueReminder(14)?.audience).toBe("coming");
  });

  it("в момент начала — «сейчас»", () => {
    expect(dueReminder(0)?.kind).toBe("meeting_now");
    expect(dueReminder(-4)?.kind).toBe("meeting_now");
  });

  it("между окнами молчит: пингер ходит часто, а писать надо редко", () => {
    expect(dueReminder(600)).toBeNull();
    expect(dueReminder(60)).toBeNull();
    expect(dueReminder(-30)).toBeNull();
  });

  it("ближайшее к встрече важнее, если окна наложились", () => {
    // 15 минут попадают и в окно «за 30», и в окно «за 15».
    expect(dueReminder(15)?.kind).toBe("meeting_soon");
  });
});

describe("что человек читает", () => {
  it("молчащего спрашивают", () => {
    const text = participantReminder("meeting_2h", "Планёрка", "09.09.2026, 15:00", "unanswered");
    expect(text).toContain("Планёрка");
    expect(text).toContain("не ответили".slice(0, 3));
    expect(text).toContain("будете?");
  });

  it("согласившемуся просто напоминают, без вопроса", () => {
    const text = participantReminder("meeting_soon", "Планёрка", "09.09.2026, 15:00", "coming");
    expect(text).not.toContain("будете?");
  });

  it("владелец видит, кто молчит — это единственное, что он может решить", () => {
    const text = ownerReminder("meeting_24h", "Планёрка", "10.09.2026, 10:00", {
      yes: ["Аня"],
      no: [{ name: "Борис" }],
      pending: ["Глеб"],
    });
    expect(text).toContain("будут: Аня");
    expect(text).toContain("не смогут: Борис");
    expect(text).toContain("не ответили: Глеб");
  });
});
