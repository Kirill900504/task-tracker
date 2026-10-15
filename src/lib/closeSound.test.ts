import { describe, expect, it } from "vitest";
import { ideaJustClosed, meetingJustClosed, taskJustClosed } from "./closeSound";
import type { Idea, Meeting, Task } from "@/types/tracker";

const task = (p: Partial<Task>) => ({ status: "in_progress", recur: "none", approvalState: "open", ...p }) as Task;
const meeting = (p: Partial<Meeting>) => ({ status: "planned", movedToDate: "", ...p }) as Meeting;
const idea = (p: Partial<Idea>) => ({ done: false, ...p }) as Idea;

describe("closeSound — звучит только переход в закрытое", () => {
  it("задача: галочка и приёмка звучат, новая и уже закрытая — нет", () => {
    expect(taskJustClosed(task({}), task({ status: "done" }))).toBe(true);
    expect(taskJustClosed(task({}), task({ approvalState: "accepted" }))).toBe(true);
    expect(taskJustClosed(undefined, task({ status: "done" }))).toBe(false);
    expect(taskJustClosed(task({ status: "done" }), task({ status: "done" }))).toBe(false);
    expect(taskJustClosed(task({ status: "done" }), task({}))).toBe(false);
  });
  it("встреча: исход звучит, перенос — нет", () => {
    expect(meetingJustClosed(meeting({}), meeting({ status: "success" }))).toBe(true);
    expect(meetingJustClosed(meeting({}), meeting({ status: "no_result" }))).toBe(true);
    expect(meetingJustClosed(meeting({}), meeting({ status: "no_result", movedToDate: "2026-10-20" }))).toBe(false);
    expect(meetingJustClosed(meeting({ status: "success" }), meeting({ status: "success" }))).toBe(false);
  });
  it("мысль: вычеркнули — звучит, вернули — нет", () => {
    expect(ideaJustClosed(idea({}), idea({ done: true }))).toBe(true);
    expect(ideaJustClosed(idea({ done: true }), idea({}))).toBe(false);
  });
});
