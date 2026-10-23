import { describe, it, expect } from "vitest";
import { isSelfTask } from "./selfTask";

describe("isSelfTask", () => {
  it("на задаче только я — своя", () => {
    expect(isSelfTask([{ assigneeId: "me" }], "me")).toBe(true);
  });
  it("рядом второй исполнитель или соисполнитель — обычная", () => {
    expect(isSelfTask([{ assigneeId: "me" }, { assigneeId: "igor" }], "me")).toBe(false);
    expect(isSelfTask([{ assigneeId: "me", role: "executor" }, { assigneeId: "igor", role: "coexecutor" }], "me")).toBe(false);
  });
  it("рядом только наблюдатели — всё равно своя", () => {
    expect(isSelfTask([{ assigneeId: "me", role: "executor" }, { assigneeId: "igor", role: "watcher" }], "me")).toBe(true);
  });
  it("я наблюдатель, а работает другой — не своя", () => {
    expect(isSelfTask([{ assigneeId: "igor", role: "executor" }, { assigneeId: "me", role: "watcher" }], "me")).toBe(false);
  });
  it("одни наблюдатели без исполнителя — не своя", () => {
    expect(isSelfTask([{ assigneeId: "me", role: "watcher" }], "me")).toBe(false);
  });
  it("никого нет — не своя, а без исполнителя", () => {
    expect(isSelfTask([], "me")).toBe(false);
  });
  it("не знаю, кто я, — не своя", () => {
    expect(isSelfTask([{ assigneeId: "" }], "")).toBe(false);
  });
});
