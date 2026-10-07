import { describe, it, expect } from "vitest";
import { isSelfTask } from "./selfTask";

describe("isSelfTask", () => {
  it("на задаче только я — своя", () => {
    expect(isSelfTask([{ assigneeId: "me" }], "me")).toBe(true);
  });
  it("рядом хоть один человек, даже наблюдатель, — обычная", () => {
    expect(isSelfTask([{ assigneeId: "me" }, { assigneeId: "igor" }], "me")).toBe(false);
  });
  it("никого нет — не своя, а без исполнителя", () => {
    expect(isSelfTask([], "me")).toBe(false);
  });
  it("не знаю, кто я, — не своя", () => {
    expect(isSelfTask([{ assigneeId: "" }], "")).toBe(false);
  });
});
