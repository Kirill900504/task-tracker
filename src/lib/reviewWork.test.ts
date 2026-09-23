import { describe, it, expect } from "vitest";
import { REOPEN_PATCH } from "./reviewWork";
import { columnOf } from "./kanban";
import { taskStage } from "./taskProgress";
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

// Возврат на доработку обязан снять ПРЕЖНИЙ ОТВЕТ целиком — и отчёт, и
// отказ.
//
// Отказ стал ответом 21.09.2026 («после отказа задача не переносится на
// приёмку» — теперь переносится), и с этого дня оставленный отказ означал
// бы, что «Вернуть с объяснением» возвращает задачу в тот же тупик:
// declined_at на месте → «ответили все» → снова приёмка, и кнопка
// выглядит несработавшей. Проверяется поэтому не сам вызов базы, а его
// следствие: доска и стадия после очистки.
describe("возврат на доработку", () => {
  const person = (over: Record<string, unknown> = {}) => ({
    assigneeId: "a1",
    name: "Аня",
    role: "executor" as const,
    acceptedAt: "2026-09-20T10:00:00Z",
    doneAt: null,
    doneComment: null,
    declinedAt: null,
    declineReason: null,
    ...over,
  });

  it("задача с непогашенным отказом снова просит решения — значит гасить его обязательно", () => {
    const refused = [person({ declinedAt: "2026-09-21T10:00:00Z", declineReason: "нет людей" })];
    const task = { ...closed(), status: "in_progress", approvalState: "returned" } as Task;
    // Возврат сам по себе кладёт задачу в «В работе» — пока отказ снят.
    expect(columnOf(task, [person()])).toBe("work");
    // А если бы отказ остался, задача читалась бы как «ответили все»: это
    // и есть цена забытой колонки в applyReview.
    expect(taskStage(refused, "open")).toBe("awaiting_review");
  });
});
