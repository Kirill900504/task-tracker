import { describe, expect, it } from "vitest";
import {
  canVoteNo,
  nextRound,
  voteLabel,
  voteTally,
  votingOpen,
  type MeetingVote,
} from "./meetingVotes";

function vote(name: string, over: Partial<MeetingVote> = {}): MeetingVote {
  return {
    assigneeId: name,
    name,
    role: "participant",
    response: "none",
    reason: null,
    round: 1,
    ...over,
  };
}

describe("who is asked at all", () => {
  it("never chases the organizer or a watcher", () => {
    const votes = [
      vote("Кирилл", { role: "organizer" }),
      vote("Аня", { response: "yes" }),
      vote("Вера", { role: "watcher" }),
    ];
    const t = voteTally(votes);
    expect(t.expected).toBe(1);
    expect(t.everyoneAnswered).toBe(true);
  });
});

describe("the three answers, kept apart", () => {
  it("separates a refusal from a silence", () => {
    const votes = [
      vote("Аня", { response: "yes" }),
      vote("Борис", { response: "no", reason: "буду в Москве" }),
      vote("Глеб"),
    ];
    const t = voteTally(votes);
    expect(t.yes).toEqual(["Аня"]);
    expect(t.no).toEqual([{ name: "Борис", reason: "буду в Москве" }]);
    expect(t.pending).toEqual(["Глеб"]);
    expect(t.everyoneAnswered).toBe(false);
  });

  it("counts an answered meeting as answered only when nobody is left", () => {
    const votes = [vote("Аня", { response: "yes" }), vote("Борис", { response: "no", reason: "болен" })];
    expect(voteTally(votes).everyoneAnswered).toBe(true);
  });
});

describe("moving the meeting", () => {
  it("turns every earlier answer back into a pending one", () => {
    const votes = [
      vote("Аня", { response: "yes", round: 1 }),
      vote("Борис", { response: "no", reason: "занят", round: 1 }),
    ];
    const t = voteTally(votes, nextRound(1));
    expect(t.yes).toEqual([]);
    expect(t.no).toEqual([]);
    expect(t.pending).toEqual(["Аня", "Борис"]);
  });

  it("counts the answers given about the new time", () => {
    const votes = [
      vote("Аня", { response: "yes", round: 2 }),
      vote("Борис", { response: "yes", round: 1 }),
    ];
    const t = voteTally(votes, 2);
    expect(t.yes).toEqual(["Аня"]);
    expect(t.pending).toEqual(["Борис"]);
  });
});

describe("the line the owner reads", () => {
  it("puts everything that needs a reaction into one line", () => {
    const votes = [
      vote("Аня", { response: "yes" }),
      vote("Борис", { response: "no", reason: "буду в Москве" }),
      vote("Глеб"),
    ];
    expect(voteLabel(votes)).toBe("придут: 1 из 3 · не смогут: Борис · не ответили: Глеб");
  });

  it("says nothing when there is nobody to ask", () => {
    expect(voteLabel([vote("Кирилл", { role: "organizer" })])).toBe("");
  });
});

describe("when voting closes", () => {
  it("stays open right up to the start and shuts after it", () => {
    const starts = new Date("2026-03-02T09:00:00Z");
    expect(votingOpen(starts, new Date("2026-03-02T08:59:00Z"))).toBe(true);
    expect(votingOpen(starts, new Date("2026-03-02T09:00:00Z"))).toBe(false);
  });
});

describe("a refusal has to say why", () => {
  it("rejects an empty reason", () => {
    expect(canVoteNo("  ")).toBe(false);
    expect(canVoteNo("совещание в банке")).toBe(true);
  });
});
