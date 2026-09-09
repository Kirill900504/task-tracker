import { describe, expect, it } from "vitest";
import { composePeopleReview, personStats, reviewIsEmpty, type ParticipationRow } from "./peopleReview";

const NOW = new Date("2026-09-14T09:00:00Z"); // понедельник

function row(over: Partial<ParticipationRow> = {}): ParticipationRow {
  return {
    name: "Аня",
    direction: "Розница",
    createdAt: "2026-09-10T09:00:00Z",
    acceptedAt: null,
    doneAt: null,
    declinedAt: null,
    deadline: "",
    status: "in_progress",
    ...over,
  };
}

describe("что считается по человеку", () => {
  it("в работе — всё незакрытое", () => {
    const [s] = personStats([row(), row()], NOW);
    expect(s.open).toBe(2);
  });

  it("просрочено — по сроку задачи, а не по дате назначения", () => {
    const [s] = personStats([row({ deadline: "2026-09-01" }), row({ deadline: "2026-09-30" })], NOW);
    expect(s.overdue).toBe(1);
  });

  it("молчание считается только через сутки", () => {
    const stats = personStats(
      [
        row({ createdAt: "2026-09-10T09:00:00Z" }), // четыре дня назад
        row({ createdAt: "2026-09-14T08:00:00Z" }), // час назад — рано судить
      ],
      NOW,
    );
    expect(stats[0].silent).toBe(1);
  });

  it("принявший молчащим не считается", () => {
    const [s] = personStats([row({ acceptedAt: "2026-09-10T10:00:00Z" })], NOW);
    expect(s.silent).toBe(0);
  });

  it("отказ — это ответ, а не молчание", () => {
    const [s] = personStats([row({ declinedAt: "2026-09-11T10:00:00Z" })], NOW);
    expect(s.silent).toBe(0);
    expect(s.declined).toBe(1);
  });

  it("среднее время принятия — по тем, кто принял", () => {
    const [s] = personStats(
      [
        row({ createdAt: "2026-09-10T09:00:00Z", acceptedAt: "2026-09-10T11:00:00Z" }), // 2 ч
        row({ createdAt: "2026-09-10T09:00:00Z", acceptedAt: "2026-09-10T13:00:00Z" }), // 4 ч
        row(), // не принял — в среднее не входит
      ],
      NOW,
    );
    expect(s.avgAcceptHours).toBe(3);
  });

  it("в срок считается только по задачам со сроком", () => {
    const [s] = personStats(
      [
        row({ deadline: "2026-09-12", doneAt: "2026-09-11T10:00:00Z" }), // успел
        row({ deadline: "2026-09-10", doneAt: "2026-09-12T10:00:00Z" }), // опоздал
        row({ deadline: "", doneAt: "2026-09-12T10:00:00Z" }), // без срока — не в счёт
      ],
      NOW,
    );
    expect(s.onTimeShare).toBe(0.5);
  });

  it("не выдумывает долю, когда закрывать было нечего", () => {
    const [s] = personStats([row()], NOW);
    expect(s.onTimeShare).toBeNull();
    expect(s.avgAcceptHours).toBeNull();
  });
});

describe("порядок и текст", () => {
  it("первыми те, к кому есть вопросы", () => {
    const stats = personStats(
      [
        row({ name: "Борис", deadline: "2026-09-30", acceptedAt: "2026-09-11T09:00:00Z" }),
        row({ name: "Аня" }), // молчит четыре дня
      ],
      NOW,
    );
    expect(stats[0].name).toBe("Аня");
  });

  it("называет, кому написать лично", () => {
    const stats = personStats([row({ name: "Аня" })], NOW);
    expect(composePeopleReview(stats)).toContain("Стоит спросить лично: Аня");
  });

  it("молчит, когда сказать нечего", () => {
    expect(reviewIsEmpty([])).toBe(true);
    expect(composePeopleReview([])).toBe("");
  });

  it("показывает направление, когда оно известно", () => {
    const stats = personStats([row({ name: "Аня", direction: "ОПТ", deadline: "2026-09-01" })], NOW);
    expect(composePeopleReview(stats)).toContain("(ОПТ)");
  });
});
