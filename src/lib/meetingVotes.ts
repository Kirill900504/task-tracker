// Who is coming, who is not, and who has not answered.
//
// The old shape was `confirmed_by text[]` — a list of people who pressed
// "Буду". It cannot express the two things that matter most: a refusal with
// a reason, and the difference between "не придёт" and "не ответил". Those
// are opposite problems (one is information, the other is the absence of
// it), and lumping them together is why "подтвердили: 2 из 7" told nobody
// anything useful.
//
// The other thing encoded here is the round. Moving a meeting invalidates
// every answer about the old time — somebody who could make Tuesday has said
// nothing at all about Thursday — so a reschedule bumps the round and the
// answers below it become history rather than confirmations.

export type MeetingRole = "organizer" | "participant" | "watcher";
export type VoteResponse = "none" | "yes" | "no";

export type MeetingVote = {
  assigneeId: string;
  name: string;
  role: MeetingRole;
  response: VoteResponse;
  reason: string | null;
  // Which round of voting this answer was given in.
  round: number;
};

// The organizer is coming by definition — he called it. Watchers are kept
// informed and are never chased for an answer. Everyone else has to say.
export function mustVote(v: MeetingVote): boolean {
  return v.role === "participant";
}

// An answer given before the meeting was moved says nothing about the new
// time, so it counts as no answer at all.
export function isCurrent(v: MeetingVote, round: number): boolean {
  return v.round >= round;
}

export type VoteTally = {
  yes: string[];
  no: { name: string; reason: string }[];
  // Never answered, or answered about a time that no longer exists.
  pending: string[];
  answered: number;
  expected: number;
  everyoneAnswered: boolean;
};

export function voteTally(votes: MeetingVote[], round = 1): VoteTally {
  const asked = votes.filter(mustVote);
  const yes: string[] = [];
  const no: { name: string; reason: string }[] = [];
  const pending: string[] = [];

  for (const v of asked) {
    if (!isCurrent(v, round) || v.response === "none") pending.push(v.name);
    else if (v.response === "yes") yes.push(v.name);
    else no.push({ name: v.name, reason: v.reason || "" });
  }

  return {
    yes,
    no,
    pending,
    answered: yes.length + no.length,
    expected: asked.length,
    everyoneAnswered: asked.length > 0 && pending.length === 0,
  };
}

// C3: everyone votes again, including those who had already confirmed —
// otherwise a "✅" from the old time silently stands in for an answer about
// the new one. The old answers are not erased, they are simply left behind
// in the previous round.
export function nextRound(round: number): number {
  return round + 1;
}

export function voteLabel(votes: MeetingVote[], round = 1): string {
  const t = voteTally(votes, round);
  if (!t.expected) return "";
  const parts = [`придут: ${t.yes.length} из ${t.expected}`];
  if (t.no.length) parts.push("не смогут: " + t.no.map((n) => n.name).join(", "));
  if (t.pending.length) parts.push("не ответили: " + t.pending.join(", "));
  return parts.join(" · ");
}

// C1: an answer can be changed right up to the start — people's days move,
// and a stale "буду" is worse than a late "не смогу". After the meeting has
// begun there is nothing left to answer.
export function votingOpen(startsAt: Date, now: Date): boolean {
  return now.getTime() < startsAt.getTime();
}

// Mirrors canDecline() for tasks: a refusal has to say why.
export function canVoteNo(reason: string): boolean {
  return reason.trim().length > 0;
}
