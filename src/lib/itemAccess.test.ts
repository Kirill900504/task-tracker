import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seenItem } from "./itemAccess";

// Таблицы как массивы строк; фильтры eq/is применяются честно, чтобы тест
// проверял правило, а не то, что код спросил.
function fakeAdmin(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const conds: [string, unknown][] = [];
      const rows = () => (tables[table] || []).filter((r) => conds.every(([c, v]) => (r[c] ?? null) === v));
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => (conds.push([c, v]), chain),
        is: (c: string, v: unknown) => (conds.push([c, v]), chain),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (r: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

const SPACE = "owner";
const db = fakeAdmin({
  tasks: [
    { id: "own", title: "Своя владельца", user_id: SPACE, created_by: null },
    { id: "igor", title: "Игорь поручил Ане", user_id: SPACE, created_by: "igor-auth" },
    { id: "other-space", title: "Чужое пространство", user_id: "someone", created_by: null },
  ],
  meetings: [{ id: "m1", title: "Планёрка", user_id: SPACE, created_by: "igor-auth", participants: ["Вера"] }],
  task_participants: [{ id: "p1", task_id: "igor", assignee_id: "anya" }],
  meeting_participants: [],
  assignees: [
    { id: "kirill", user_id: SPACE, name: "Кирилл (я)" },
    { id: "anya", user_id: SPACE, name: "Аня" },
    { id: "vera", user_id: SPACE, name: "Вера" },
    { id: "boris", user_id: SPACE, name: "Борис" },
  ],
});

describe("seenItem — то же правило, что у базы", () => {
  it("автор видит своё, владелец — своё по пустому автору", async () => {
    expect(await seenItem(db, { spaceId: SPACE, authId: "igor-auth" }, "task", "igor")).toEqual({ id: "igor", title: "Игорь поручил Ане" });
    expect(await seenItem(db, { spaceId: SPACE, authId: SPACE }, "task", "own")).not.toBeNull();
  });

  it("участник видит, посторонний — нет, даже в том же пространстве", async () => {
    expect(await seenItem(db, { spaceId: SPACE, authId: null, assigneeId: "anya" }, "task", "igor")).not.toBeNull();
    expect(await seenItem(db, { spaceId: SPACE, authId: null, assigneeId: "boris" }, "task", "igor")).toBeNull();
  });

  it("владелец не видит чужое поручение, где его нет (0057)", async () => {
    expect(await seenItem(db, { spaceId: SPACE, authId: SPACE }, "task", "igor")).toBeNull();
  });

  it("встреча видна названному в списке", async () => {
    expect(await seenItem(db, { spaceId: SPACE, authId: null, assigneeId: "vera" }, "meeting", "m1")).not.toBeNull();
    expect(await seenItem(db, { spaceId: SPACE, authId: null, assigneeId: "boris" }, "meeting", "m1")).toBeNull();
  });

  it("дело из чужого пространства не видно никому", async () => {
    expect(await seenItem(db, { spaceId: SPACE, authId: SPACE }, "task", "other-space")).toBeNull();
  });
});
