import { describe, expect, it } from "vitest";
import {
  canDecline,
  canReportDone,
  executors,
  progressLabel,
  taskProgress,
  taskStage,
  type TaskParticipant,
} from "./taskProgress";

function person(name: string, over: Partial<TaskParticipant> = {}): TaskParticipant {
  return {
    assigneeId: name,
    name,
    role: "executor",
    acceptedAt: null,
    doneAt: null,
    doneComment: null,
    declinedAt: null,
    declineReason: null,
    ...over,
  };
}

const t = "2026-03-01T10:00:00Z";

describe("who holds a task open", () => {
  it("counts only executors", () => {
    const list = [person("Аня"), person("Борис", { role: "coexecutor" }), person("Вера", { role: "watcher" })];
    expect(executors(list).map((p) => p.name)).toEqual(["Аня"]);
  });

  it("does not wait for co-executors or watchers to report", () => {
    const list = [
      person("Аня", { doneAt: t, doneComment: "сделал" }),
      person("Борис", { role: "coexecutor" }),
      person("Вера", { role: "watcher" }),
    ];
    expect(taskProgress(list).allDone).toBe(true);
  });
});

describe("progress across several executors", () => {
  it("stays open while anyone has not reported", () => {
    const list = [person("Аня", { doneAt: t, doneComment: "готово" }), person("Борис", { acceptedAt: t })];
    const p = taskProgress(list);
    expect(p.doneCount).toBe(1);
    expect(p.total).toBe(2);
    expect(p.allDone).toBe(false);
    expect(p.pendingNames).toEqual(["Борис"]);
  });

  it("is not done when there is nobody to do it", () => {
    expect(taskProgress([person("Вера", { role: "watcher" })]).allDone).toBe(false);
  });

  it("reports a refusal with its reason", () => {
    const list = [person("Аня", { declinedAt: t, declineReason: "уехал на объект" })];
    expect(taskProgress(list).declined).toEqual([{ name: "Аня", reason: "уехал на объект" }]);
  });

  it("treats work actually done as newer than an earlier refusal", () => {
    const list = [person("Аня", { declinedAt: t, declineReason: "не успею", doneAt: t, doneComment: "всё же успел" })];
    const p = taskProgress(list);
    expect(p.declined).toEqual([]);
    expect(p.allDone).toBe(true);
  });
});

describe("the stage a card shows", () => {
  it("is 'sent' until somebody picks it up", () => {
    expect(taskStage([person("Аня")], "open")).toBe("sent");
  });

  it("is 'accepted' once someone took it", () => {
    expect(taskStage([person("Аня", { acceptedAt: t }), person("Борис")], "open")).toBe("accepted");
  });

  it("is 'blocked' when an executor cannot do it", () => {
    const list = [person("Аня", { acceptedAt: t }), person("Борис", { declinedAt: t, declineReason: "нет людей" })];
    expect(taskStage(list, "open")).toBe("blocked");
  });

  it("waits for the person who set it once everyone has reported", () => {
    const list = [person("Аня", { doneAt: t, doneComment: "ок" }), person("Борис", { doneAt: t, doneComment: "ок" })];
    expect(taskStage(list, "open")).toBe("awaiting_review");
  });

  it("is done only when the result was accepted", () => {
    const list = [person("Аня", { doneAt: t, doneComment: "ок" })];
    expect(taskStage(list, "awaiting_review")).toBe("awaiting_review");
    expect(taskStage(list, "accepted")).toBe("done");
  });

  it("goes back to work when the result was returned", () => {
    const list = [person("Аня", { doneAt: t, doneComment: "ок" })];
    expect(taskStage(list, "returned")).toBe("returned");
  });

  it("stays done after a forced close, whatever the executors did", () => {
    expect(taskStage([person("Аня"), person("Борис")], "accepted")).toBe("done");
  });
});

describe("the line on the card", () => {
  it("says how many and who is missing", () => {
    const list = [
      person("Аня", { doneAt: t, doneComment: "ок" }),
      person("Борис", { doneAt: t, doneComment: "ок" }),
      person("Вера", { acceptedAt: t }),
      person("Глеб"),
    ];
    expect(progressLabel(list)).toBe("2 из 4 · сделали: Аня, Борис · ждём: Вера, Глеб");
  });

  it("names whoever refused", () => {
    const list = [person("Аня", { declinedAt: t, declineReason: "болен" })];
    expect(progressLabel(list)).toBe("0 из 1 · не может: Аня");
  });

  it("says nothing when nobody is assigned", () => {
    expect(progressLabel([person("Вера", { role: "watcher" })])).toBe("");
  });
});

describe("reporting requires words", () => {
  it("refuses an empty report or refusal", () => {
    expect(canReportDone("   ")).toBe(false);
    expect(canDecline("")).toBe(false);
  });

  it("accepts a short one — the rule is words, not length", () => {
    expect(canReportDone("ок")).toBe(true);
    expect(canDecline("нет людей")).toBe(true);
  });
});
