import { describe, it, expect } from "vitest";
import { voteTally, type MeetingVote } from "./meetingVotes";

// Правило «предложение, на которое согласились все, становится встречей»
// целиком держится на одном вопросе: кто считается ответившим. Сам переход
// делает confirmIfEveryoneAgreed (он ходит в базу и проверяется в
// test:bots на боевом), а здесь — та арифметика, на которой он стоит.
//
// Проверять её стоит отдельно, потому что каждая строка тут — решение, а
// не подсчёт: организатор не голосует, наблюдателя не спрашивают,
// опоздание — это согласие, а ответ, данный до переноса, согласием быть
// перестаёт.

function vote(over: Partial<MeetingVote> = {}): MeetingVote {
  return {
    assigneeId: "a" + Math.random().toString(36).slice(2, 6),
    name: "Кто-то",
    role: "participant",
    response: "none",
    reason: null,
    round: 1,
    ...over,
  };
}

const agreed = (votes: MeetingVote[], round = 1) => {
  const t = voteTally(votes, round);
  return !!t.expected && !t.pending.length && !t.no.length;
};

describe("когда предложение становится встречей", () => {
  it("все сказали «буду» — становится", () => {
    expect(agreed([vote({ name: "Есина", response: "yes" }), vote({ name: "Мамакова", response: "yes" })])).toBe(true);
  });

  it("один молчит — ещё нет", () => {
    expect(agreed([vote({ name: "Есина", response: "yes" }), vote({ name: "Мамакова" })])).toBe(false);
  });

  it("один отказался — нет, и это не отменяет встречу: решает организатор", () => {
    expect(agreed([vote({ name: "Есина", response: "yes" }), vote({ name: "Мамакова", response: "no", reason: "в отпуске" })])).toBe(false);
  });

  it("опоздание — это согласие: человек придёт, просто позже", () => {
    expect(agreed([vote({ name: "Есина", response: "yes", late: true }), vote({ name: "Мамакова", response: "yes" })])).toBe(true);
  });

  it("организатор и наблюдатель не держат встречу: их не спрашивают", () => {
    const votes = [
      vote({ name: "Макаров", role: "organizer", response: "none" }),
      vote({ name: "Наблюдатель", role: "watcher", response: "none" }),
      vote({ name: "Есина", response: "yes" }),
    ];
    expect(agreed(votes)).toBe(true);
  });

  it("никого не позвали — подтверждать нечего", () => {
    expect(agreed([vote({ name: "Макаров", role: "organizer", response: "yes" })])).toBe(false);
  });

  it("согласие с прошлого времени не считается: после переноса спрашивают заново", () => {
    const votes = [vote({ name: "Есина", response: "yes", round: 1 }), vote({ name: "Мамакова", response: "yes", round: 1 })];
    expect(agreed(votes, 2)).toBe(false);
  });
});
