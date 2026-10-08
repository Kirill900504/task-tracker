import { describe, it, expect } from "vitest";
import { pickSelfTasks } from "./selfTaskServer";

const members = [{ member_id: "u-igor", assignee_id: "a-igor" }];

describe("pickSelfTasks — своя задача на сервере", () => {
  it("руководитель поставил себе — своя", () => {
    const set = pickSelfTasks({
      tasks: [{ id: "t", created_by: "u-igor" }],
      participants: [{ task_id: "t", assignee_id: "a-igor", name: "Игорь Витковский" }],
      members,
    });
    expect(set.has("t")).toBe(true);
  });

  it("владелец поставил себе (created_by пуст) — своя по метке «(я)»", () => {
    const set = pickSelfTasks({
      tasks: [{ id: "t", created_by: null }],
      participants: [{ task_id: "t", assignee_id: "a-k", name: "Кирилл Кучеренко (я)" }],
      members,
    });
    expect(set.has("t")).toBe(true);
  });

  it("рядом хоть наблюдатель — обычная", () => {
    const set = pickSelfTasks({
      tasks: [{ id: "t", created_by: "u-igor" }],
      participants: [
        { task_id: "t", assignee_id: "a-igor", name: "Игорь" },
        { task_id: "t", assignee_id: "a-nik", name: "Никита" },
      ],
      members,
    });
    expect(set.has("t")).toBe(false);
  });

  it("поручено другому — обычная; без участников — не своя", () => {
    const set = pickSelfTasks({
      tasks: [
        { id: "a", created_by: null },
        { id: "b", created_by: "u-igor" },
      ],
      participants: [{ task_id: "a", assignee_id: "a-igor", name: "Игорь" }],
      members,
    });
    expect(set.size).toBe(0);
  });

  it("постановщик без строки в списке людей — не своя (не угадываем)", () => {
    const set = pickSelfTasks({
      tasks: [{ id: "t", created_by: "u-stranger" }],
      participants: [{ task_id: "t", assignee_id: "a-igor", name: "Игорь" }],
      members,
    });
    expect(set.has("t")).toBe(false);
  });
});
