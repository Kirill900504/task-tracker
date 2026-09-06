import { describe, it, expect } from "vitest";
import { encodeCallback, decodeCallback, taskMessage, meetingMessage, ideaMessage, taskButtons, meetingButtons } from "@/lib/colleagues";

describe("callback data", () => {
  it("survives a round trip", () => {
    const encoded = encodeCallback("task", "acc", "abc123");
    expect(decodeCallback(encoded)).toEqual({ kind: "task", action: "acc", id: "abc123" });
  });

  it("stays inside Telegram's 64-byte limit for a real id", () => {
    expect(encodeCallback("meeting", "yes", "tg" + "m".repeat(20)).length).toBeLessThanOrEqual(64);
  });

  it("understands all three kinds", () => {
    expect(decodeCallback("t:acc:1")?.kind).toBe("task");
    expect(decodeCallback("m:yes:1")?.kind).toBe("meeting");
    expect(decodeCallback("i:x:1")?.kind).toBe("idea");
  });

  it("rejects anything malformed rather than guessing", () => {
    expect(decodeCallback("")).toBeNull();
    expect(decodeCallback("nonsense")).toBeNull();
    expect(decodeCallback("x:acc:1")).toBeNull();
    expect(decodeCallback("t:acc:")).toBeNull();
    expect(decodeCallback("t:acc:1:extra")).toBeNull();
  });
});

describe("what a colleague receives", () => {
  it("says who it is from, and shows the deadline and priority", () => {
    const text = taskMessage({ title: "Подготовить смету", deadline: "2026-09-11", priority: "high" }, "Кирилл");
    expect(text).toContain("Кирилл");
    expect(text).toContain("Подготовить смету");
    expect(text).toContain("11.09.2026");
    expect(text).toContain("важно");
  });

  it("leaves out what a task does not have", () => {
    const text = taskMessage({ title: "Купить воду" }, "Кирилл");
    expect(text).toContain("Купить воду");
    expect(text).not.toContain("срок");
    expect(text).not.toContain("важно");
  });

  it("gives a meeting its date, time and the other participants", () => {
    const text = meetingMessage({ title: "Совещание", date: "2026-09-10", time: "11:00", participants: ["Никита", "Игорь"] }, "Кирилл");
    expect(text).toContain("10.09.2026, 11:00");
    expect(text).toContain("Никита, Игорь");
  });

  it("does not list participants when there is only the one recipient", () => {
    const text = meetingMessage({ title: "Разговор", date: "2026-09-10", participants: ["Никита"] }, "Кирилл");
    expect(text).not.toContain("Участники");
  });

  it("passes a thought through as it was written", () => {
    expect(ideaMessage("Открыть склад в Севастополе", "Кирилл")).toContain("Открыть склад в Севастополе");
  });
});

describe("buttons", () => {
  it("offers accept and done on a task, both carrying its id", () => {
    const rows = taskButtons("t42");
    expect(rows[0].map((b) => b.callback_data)).toEqual(["t:acc:t42", "t:done:t42"]);
  });

  it("offers a single confirmation on a meeting", () => {
    expect(meetingButtons("m7")[0]).toHaveLength(1);
    expect(meetingButtons("m7")[0][0].callback_data).toBe("m:yes:m7");
  });
});
