// A task with several executors: what state it is actually in.
//
// One assignee and a `status` column could answer "done?" with a boolean.
// Four people cannot: three may have reported and the fourth gone quiet, one
// may have refused outright, and the whole thing may be waiting on the
// person who set it to accept the result. That is five different situations
// a card has to show differently, and every one of them is derived here from
// the participant rows — nothing about progress is stored twice.
//
// Only executors hold a task open. Co-executors help and watchers watch;
// neither is ever the reason something is still in work. Deciding that here,
// once, is what keeps the rule from drifting between the card, the bot and
// the morning briefing.

export type TaskParticipantRole = "executor" | "coexecutor" | "watcher";

export type TaskParticipant = {
  assigneeId: string;
  name: string;
  role: TaskParticipantRole;
  acceptedAt: string | null;
  doneAt: string | null;
  doneComment: string | null;
  declinedAt: string | null;
  declineReason: string | null;
};

// Where the task stands, in the order it normally travels:
//   sent            — nobody has picked it up yet
//   accepted        — at least one executor took it, not everyone has finished
//   blocked         — an executor said he cannot, and has not since reported
//   awaiting_review — everyone reported; it is now on the person who set it
//   returned        — sent back for rework
//   done            — accepted by the person who set it, or force-closed
export type TaskStage = "sent" | "accepted" | "blocked" | "awaiting_review" | "returned" | "done";

export type ApprovalState = "open" | "awaiting_review" | "accepted" | "returned";

export function executors(participants: TaskParticipant[]): TaskParticipant[] {
  return participants.filter((p) => p.role === "executor");
}

// A refusal that was later withdrawn by actually doing the work is not a
// refusal any more — the report is the newer fact, so `done` wins.
export function hasDeclined(p: TaskParticipant): boolean {
  return !!p.declinedAt && !p.doneAt;
}

export type TaskProgress = {
  total: number;
  doneCount: number;
  acceptedCount: number;
  doneNames: string[];
  pendingNames: string[];
  declined: { name: string; reason: string }[];
  // True only when there is somebody to wait for and nobody is left.
  allDone: boolean;
};

export function taskProgress(participants: TaskParticipant[]): TaskProgress {
  const list = executors(participants);
  const done = list.filter((p) => !!p.doneAt);
  const declined = list.filter(hasDeclined);
  const pending = list.filter((p) => !p.doneAt && !hasDeclined(p));
  return {
    total: list.length,
    doneCount: done.length,
    acceptedCount: list.filter((p) => !!p.acceptedAt && !p.doneAt).length,
    doneNames: done.map((p) => p.name),
    pendingNames: pending.map((p) => p.name),
    declined: declined.map((p) => ({ name: p.name, reason: p.declineReason || "" })),
    allDone: list.length > 0 && done.length === list.length,
  };
}

export function taskStage(participants: TaskParticipant[], approval: ApprovalState): TaskStage {
  // Acceptance is the owner's word and outranks everything the executors
  // have or have not pressed — including a task closed over their heads.
  if (approval === "accepted") return "done";
  if (approval === "returned") return "returned";

  const progress = taskProgress(participants);
  if (progress.allDone) return "awaiting_review";
  if (progress.declined.length) return "blocked";
  if (progress.acceptedCount > 0) return "accepted";
  return "sent";
}

// "2 из 4" is the line that makes the card readable at a glance; the names
// are what make it actionable — the point is to see WHO is missing without
// opening anything.
export function progressLabel(participants: TaskParticipant[]): string {
  const p = taskProgress(participants);
  if (!p.total) return "";
  const parts = [`${p.doneCount} из ${p.total}`];
  if (p.doneNames.length) parts.push("сделали: " + p.doneNames.join(", "));
  if (p.pendingNames.length) parts.push("ждём: " + p.pendingNames.join(", "));
  if (p.declined.length) parts.push("не может: " + p.declined.map((d) => d.name).join(", "));
  return parts.join(" · ");
}

// B5: a report without a comment is not a report. Deliberately only a
// non-empty check — a minimum length would produce the word "ок" and buy
// nothing.
export function canReportDone(comment: string): boolean {
  return comment.trim().length > 0;
}

// B3: same rule for a refusal. A refusal with no reason is the silence this
// whole system exists to stop, just with a button pressed.
export function canDecline(reason: string): boolean {
  return reason.trim().length > 0;
}
