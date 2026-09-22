import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Успешная встреча закрывает задачу, из которой выросла, — и не закрывает
// всё остальное.
//
// Правило родилось из слов Кирилла 21.09.2026: окончательная приёмка часто
// возможна только после личного разговора, поэтому задачу несут из «На
// приёмке» во встречу, а успешная встреча принимает по ней работу тем же
// комментарием. Опасная половина правила — вторая: приёмка закрывает чужую
// работу и пишет о ней людям, значит ошибка здесь стоит дороже неудобства.
//
// Проверяются поэтому именно ГРАНИЦЫ, а не счастливый путь: задача не в
// приёмке, встреча собрана не постановщиком, задача уже закрыта. Ни одну из
// них не видно ни типами (везде строки), ни глазами — все три ветки
// выглядят одинаково.

const applyReview = vi.fn();

vi.mock("@/lib/reviewWork", () => ({
  applyReview: (...args: unknown[]) => applyReview(...args),
}));
vi.mock("@/lib/reach", () => ({ sendToPerson: vi.fn().mockResolvedValue(1) }));
vi.mock("@/lib/itemHistory", () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }));

const { approveTaskFromMeeting } = await import("./meetingRecap");

type TaskRow = {
  id: string;
  title: string;
  user_id: string;
  created_by: string | null;
  approval_state: string | null;
  status: string | null;
};

// Поддельный клиент ровно той формы, которой пользуется проверяемая
// функция: одна строка задачи и список исполнителей. Цепочка возвращает
// саму себя, поэтому порядок .eq()/.is() в коде можно менять, не трогая
// тест, — а он и правда менялся.
function fakeAdmin(task: TaskRow | null, executors: { done_at: string | null }[]): SupabaseClient {
  const chain = (result: unknown) => {
    const node: Record<string, unknown> = {
      select: () => node,
      eq: () => node,
      is: () => node,
      maybeSingle: async () => ({ data: task }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: result }).then(resolve),
    };
    return node;
  };
  return { from: (table: string) => chain(table === "tasks" ? task : executors) } as unknown as SupabaseClient;
}

const meeting = {
  id: "m1",
  title: "Смета по опту",
  date: "2026-09-21",
  time: "10:00",
  user_id: "owner-1",
  from_task_id: "t1",
};

const onReview: TaskRow = {
  id: "t1",
  title: "Собрать смету",
  user_id: "owner-1",
  created_by: null,
  approval_state: "awaiting_review",
  status: "in_progress",
};

const owner = { label: "Кирилл Кучеренко", userId: "owner-1" };

beforeEach(() => {
  applyReview.mockReset().mockResolvedValue({ ok: true });
});

describe("approveTaskFromMeeting", () => {
  it("задача с приёмки принимается тем же комментарием, что записан итогом", async () => {
    const closed = await approveTaskFromMeeting(fakeAdmin(onReview, []), meeting, "Смету согласовали, Игорь сдаёт в пятницу", owner);
    expect(closed).toBe(true);
    expect(applyReview).toHaveBeenCalledTimes(1);
    const [, task, action, comment] = applyReview.mock.calls[0];
    expect(task).toEqual({ id: "t1", title: "Собрать смету", user_id: "owner-1" });
    expect(action).toBe("approve");
    expect(comment).toBe("Смету согласовали, Игорь сдаёт в пятницу");
  });

  it("пустой итог — не пустой комментарий: иначе «✅ Принято» приходит без причины", async () => {
    await approveTaskFromMeeting(fakeAdmin(onReview, []), meeting, "   ", owner);
    expect(applyReview.mock.calls[0][3]).toBe("Принято по итогам встречи «Смета по опту»");
  });

  it("отчитались все — это тоже приёмка, даже если approval_state ещё «open»", async () => {
    const admin = fakeAdmin({ ...onReview, approval_state: "open" }, [{ done_at: "2026-09-20" }, { done_at: "2026-09-21" }]);
    expect(await approveTaskFromMeeting(admin, meeting, "готово", owner)).toBe(true);
  });

  it("кто-то ещё не отчитался — встреча ничего не закрывает", async () => {
    const admin = fakeAdmin({ ...onReview, approval_state: "open" }, [{ done_at: "2026-09-20" }, { done_at: null }]);
    expect(await approveTaskFromMeeting(admin, meeting, "договорились", owner)).toBe(false);
    expect(applyReview).not.toHaveBeenCalled();
  });

  it("исполнителей нет вовсе — закрывать нечего", async () => {
    const admin = fakeAdmin({ ...onReview, approval_state: "open" }, []);
    expect(await approveTaskFromMeeting(admin, meeting, "договорились", owner)).toBe(false);
  });

  it("встречу собрал не постановщик — итог допишется, приёмки не будет", async () => {
    const admin = fakeAdmin({ ...onReview, user_id: "owner-1", created_by: "boss-9" }, []);
    expect(await approveTaskFromMeeting(admin, meeting, "всё хорошо", { label: "Юрий", userId: "someone-else" })).toBe(false);
    expect(applyReview).not.toHaveBeenCalled();
  });

  it("задача поставлена руководителем — он и принимает", async () => {
    const admin = fakeAdmin({ ...onReview, created_by: "boss-9" }, []);
    expect(await approveTaskFromMeeting(admin, meeting, "принято", { label: "Юрий", userId: "boss-9" })).toBe(true);
  });

  it("задача уже закрыта — второй раз «принято» не говорят", async () => {
    const admin = fakeAdmin({ ...onReview, status: "done", approval_state: "accepted" }, []);
    expect(await approveTaskFromMeeting(admin, meeting, "принято", owner)).toBe(false);
    expect(applyReview).not.toHaveBeenCalled();
  });

  it("встреча выросла не из задачи — в базу за ней даже не ходим", async () => {
    const admin = fakeAdmin(onReview, []);
    expect(await approveTaskFromMeeting(admin, { ...meeting, from_task_id: null }, "итог", owner)).toBe(false);
    expect(applyReview).not.toHaveBeenCalled();
  });
});
