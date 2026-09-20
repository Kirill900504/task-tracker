import { describe, it, expect } from "vitest";
import { REOPEN_PATCH } from "./reviewWork";
import { columnOf } from "./kanban";
import type { Task } from "@/types/tracker";

// Выход из «Завершённых» проверяется тем же способом, каким туда попадают:
// доска выводит столбец из строки задачи, поэтому достаточно применить
// патч к закрытой задаче и спросить доску, где она теперь.
//
// Проверять здесь стоит именно это, а не набор колонок: набор менялся
// дважды и оба раза «почти правильно» — статус снимали, приёмку нет, и
// задача оставалась закрытой при снятой галочке.

function closed(extra: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Задача",
    desc: "",
    assignee: "Аня",
    sectionId: "",
    priority: "med",
    term: "short",
    status: "done",
    deadline: "",
    recur: "none",
    recurWeekday: "",
    recurMonthday: "",
    recurYearDay: "",
    approvalState: "accepted",
    ...extra,
  } as Task;
}

describe("REOPEN_PATCH", () => {
  it("возвращает принятую задачу из «Завершённых» в работу", () => {
    expect(columnOf(closed(), [])).toBe("done");
    const reopened = { ...closed(), status: REOPEN_PATCH.status, approvalState: REOPEN_PATCH.approval_state } as Task;
    expect(columnOf(reopened, [])).not.toBe("done");
  });

  it("снимает и статус, и приёмку — одного мало", () => {
    // Снят только статус: приёмка держит задачу закрытой сама.
    expect(columnOf({ ...closed(), status: "in_progress" } as Task, [])).toBe("done");
    // Снята только приёмка: статус держит её закрытой сам.
    expect(columnOf({ ...closed(), approvalState: "open" } as Task, [])).toBe("done");
  });

  it("стирает следы закрытия, а не только его признак", () => {
    // Волевое закрытие оставляло причину и того, кто закрыл; заново
    // открытая задача с чужой причиной внутри читается как закрытая.
    expect(REOPEN_PATCH.force_closed_by).toBeNull();
    expect(REOPEN_PATCH.force_closed_reason).toBeNull();
    expect(REOPEN_PATCH.approved_at).toBeNull();
    expect(REOPEN_PATCH.completed_at).toBeNull();
    expect(REOPEN_PATCH.last_completed_on).toBeNull();
  });
});
