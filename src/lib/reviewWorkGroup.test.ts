import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyReview } from "./reviewWork";
import { columnOf } from "./kanban";
import type { Task } from "@/types/tracker";
import type { TaskParticipant } from "./taskProgress";

// Задача №111, 21.10.2026: шестеро изучают книгу каждый сам, трое
// отчитались, четвёртый случайно нажал «сдал задачу целиком» — и задача
// ушла на приёмку, не дождавшись двоих. Возврат на доработку снимал
// отчёты у всех четверых, «дождаться остальных» не было вовсе.
//
// Проверяется ЗАПИСЬ в базу — какие строки участия возврат трогает, — а
// не экран: экран выводится из строк, и ошибка «снял у всех» живёт
// именно в записи.

type Row = { id: string; assignee_id: string; done_at: string | null; declined_at: string | null; assignees: { name: string } };

function group(): Row[] {
  const r = (id: string, name: string, done: boolean): Row => ({
    id,
    assignee_id: "a-" + id,
    done_at: done ? "2026-10-21T09:00:00Z" : null,
    declined_at: null,
    assignees: { name },
  });
  return [
    r("p1", "Евгений Макаров", true),
    r("p2", "Михаил Котов", true),
    r("p3", "Игорь Витковский", true),
    r("p4", "Станислав Синецкий", true),
    r("p5", "Юрий Нодберг", false),
    r("p6", "Никита Козлов", false),
  ];
}

type Write = { table: string; op: "update" | "insert"; payload: Record<string, unknown>; filters: [string, unknown[]][] };

function fakeAdmin(rows: Row[], approval = "awaiting_review") {
  const writes: Write[] = [];
  const admin = {
    from: (table: string) => {
      let write: Write | null = null;
      const node: Record<string, unknown> = {};
      const filter = (name: string) => (...args: unknown[]) => {
        write?.filters.push([name, args]);
        return node;
      };
      Object.assign(node, {
        select: () => node,
        eq: filter("eq"),
        in: filter("in"),
        or: filter("or"),
        neq: filter("neq"),
        not: filter("not"),
        is: filter("is"),
        limit: () => node,
        update: (payload: Record<string, unknown>) => {
          write = { table, op: "update", payload, filters: [] };
          writes.push(write);
          return node;
        },
        insert: (payload: Record<string, unknown>) => {
          writes.push({ table, op: "insert", payload, filters: [] });
          return node;
        },
        maybeSingle: async () => ({ data: table === "tasks" ? { approval_state: approval, recur: "none", number: 111 } : null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: write ? null : table === "task_participants" ? rows : [], error: null }).then(resolve),
      });
      return node;
    },
  } as unknown as SupabaseClient;
  return { admin, writes };
}

const task = { id: "t111", title: "Разбор книги Друкера", user_id: "owner-1", status: "in_progress" };
const owner = { label: "Кирилл Кучеренко", userId: "owner-1" };

describe("возврат на доработку выбранным исполнителям", () => {
  it("снимает отчёт только у выбранного, остальные отчёты остаются", async () => {
    const { admin, writes } = fakeAdmin(group());
    const res = await applyReview(admin, task, "return", "Сделано не полностью", owner, true, undefined, ["p4"]);
    expect(res.ok).toBe(true);
    const cleared = writes.find((w) => w.table === "task_participants" && w.op === "update");
    expect(cleared?.payload.done_at).toBeNull();
    expect(cleared?.filters).toEqual([["in", ["id", ["p4"]]]]);
  });

  it("плашка и хроника называют, кому вернули", async () => {
    const { admin, writes } = fakeAdmin(group());
    await applyReview(admin, task, "return", "Сделано не полностью", owner, true, undefined, ["p4"]);
    const state = writes.find((w) => w.table === "tasks" && w.op === "update");
    expect(state?.payload.approval_state).toBe("returned");
    expect(state?.payload.approval_comment).toBe("Станислав Синецкий — Сделано не полностью");
    const history = writes.find((w) => w.table === "item_comments");
    expect(String(history?.payload.body)).toContain("вернул на доработку Станислав Синецкий");
  });

  it("без выбора — всем, кто ответил, и только им: молчащих возврат не касается", async () => {
    const { admin, writes } = fakeAdmin(group());
    await applyReview(admin, task, "return", "Переделайте", owner, true);
    const cleared = writes.find((w) => w.table === "task_participants" && w.op === "update");
    expect(cleared?.filters).toEqual([["in", ["id", ["p1", "p2", "p3", "p4"]]]]);
  });

  it("вернуть тому, кто ещё не отчитывался, нельзя — снимать нечего", async () => {
    const { admin, writes } = fakeAdmin(group());
    const res = await applyReview(admin, task, "return", "Доделайте", owner, true, undefined, ["p5"]);
    expect(res.ok).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("«Дождаться всех»", () => {
  it("снимает приёмку и не трогает ничьих отчётов", async () => {
    const { admin, writes } = fakeAdmin(group());
    const res = await applyReview(admin, task, "wait", "", owner, true);
    expect(res.ok).toBe(true);
    expect(writes.filter((w) => w.table === "task_participants")).toEqual([]);
    const state = writes.find((w) => w.table === "tasks" && w.op === "update");
    expect(state?.payload).toEqual({ approval_state: "open" });
  });

  it("ждать некого — отказ, а не тихая смена состояния", async () => {
    const all = group().map((r) => ({ ...r, done_at: "2026-10-21T09:00:00Z" }));
    const { admin, writes } = fakeAdmin(all);
    const res = await applyReview(admin, task, "wait", "", owner, true);
    expect(res.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("повторное нажатие на уже ждущую задачу ничего не пишет", async () => {
    const { admin, writes } = fakeAdmin(group(), "open");
    expect((await applyReview(admin, task, "wait", "", owner, true)).ok).toBe(true);
    expect(writes).toEqual([]);
  });
});

// Следствие на доске: после частичного возврата задача в работе, а когда
// вернувшийся отчитается заново, она снова на приёмке — сданные отчёты
// остальных для этого переподтверждать не нужно.
describe("доска после частичного возврата", () => {
  const p = (name: string, done: boolean): TaskParticipant => ({
    assigneeId: name,
    name,
    role: "executor",
    acceptedAt: "2026-10-20T09:00:00Z",
    doneAt: done ? "2026-10-21T09:00:00Z" : null,
    doneComment: done ? "сделал" : null,
    declinedAt: null,
    declineReason: null,
  });
  const t = { id: "t111", title: "Разбор", status: "in_progress", recur: "none", approvalState: "returned" } as Task;

  it("вернули одному из двоих — задача в работе", () => {
    expect(columnOf(t, [p("Аня", true), p("Боря", false)])).toBe("work");
  });

  it("вернувшийся отчитался — снова на приёмке, второй ничего не нажимал", () => {
    expect(columnOf(t, [p("Аня", true), p("Боря", true)])).toBe("review");
  });
});
