import { describe, it, expect } from "vitest";
import { columnOf, moveBetween } from "./kanban";
import type { Task } from "@/types/tracker";
import type { TaskParticipant } from "@/lib/taskProgress";

function task(extra: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Задача",
    desc: "",
    assignee: "Аня",
    sectionId: "",
    priority: "med",
    term: "short",
    status: "in_progress",
    deadline: "",
    recur: "none",
    recurWeekday: "",
    recurMonthday: "",
    recurYearDay: "",
    recurYearMonth: "",
    lastCompletedOn: "",
    manualOrder: null,
    completedAt: "",
    ...extra,
  };
}

function person(extra: Partial<TaskParticipant> = {}): TaskParticipant {
  return {
    assigneeId: "a1",
    name: "Аня",
    role: "executor",
    acceptedAt: null,
    doneAt: null,
    doneComment: null,
    declinedAt: null,
    declineReason: null,
    ...extra,
  };
}

describe("columnOf", () => {
  it("кладёт в «Новые» то, на что ещё никто не ответил", () => {
    expect(columnOf(task(), [person()])).toBe("new");
  });

  it("переводит в «В работе», как только исполнитель принял", () => {
    expect(columnOf(task(), [person({ acceptedAt: "2026-09-19T10:00:00Z" })])).toBe("work");
  });

  it("отказ единственного исполнителя — это ответ, и дальше решает постановщик", () => {
    // Раньше такая задача оставалась «в работе», и это было неправдой:
    // человек ответил «не могу» и ждёт, а столбец говорил «идёт» и не
    // просил ничего ни у кого. Ждать было некого (слова Кирилла
    // 21.09.2026 про отказ).
    expect(columnOf(task(), [person({ declinedAt: "2026-09-19T10:00:00Z", declineReason: "нет доступа" })])).toBe("review");
  });

  it("держит в работе, пока отчитались не все", () => {
    const list = [person({ doneAt: "2026-09-19T10:00:00Z" }), person({ assigneeId: "a2", name: "Борис" })];
    expect(columnOf(task(), list)).toBe("work");
  });

  it("держит в работе, пока один отказался, а другой ещё молчит", () => {
    // «Ответили все» — это про ВСЕХ: один отказ не решает за того, от кого
    // ещё ждут слова. Иначе задача уехала бы на приёмку с работой, которую
    // никто не начинал.
    const list = [
      person({ declinedAt: "2026-09-19T10:00:00Z", declineReason: "нет доступа" }),
      person({ assigneeId: "a2", name: "Борис" }),
    ];
    expect(columnOf(task(), list)).toBe("work");
  });

  it("отправляет на приёмку, когда один отчитался, а другой отказался", () => {
    // Смешанный случай и есть тот, ради которого появилось «ответили все»:
    // принимать половину работы нечего, а решать есть что — вернуть,
    // перенести срок или закрыть волевым решением.
    const list = [
      person({ doneAt: "2026-09-19T10:00:00Z" }),
      person({ assigneeId: "a2", name: "Борис", declinedAt: "2026-09-19T11:00:00Z", declineReason: "занят" }),
    ];
    expect(columnOf(task(), list)).toBe("review");
  });

  it("отправляет на приёмку, когда отчитались все исполнители", () => {
    const list = [
      person({ doneAt: "2026-09-19T10:00:00Z" }),
      person({ assigneeId: "a2", name: "Борис", doneAt: "2026-09-19T11:00:00Z" }),
      // Наблюдатель не держит задачу открытой и на подсчёт не влияет.
      person({ assigneeId: "a3", name: "Вера", role: "watcher" }),
    ];
    expect(columnOf(task(), list)).toBe("review");
  });

  it("возврат на доработку — это снова работа, а не новая задача", () => {
    expect(columnOf(task({ approvalState: "returned" }), [person({ acceptedAt: "x" })])).toBe("work");
  });

  it("принятая и закрытая задача — «Завершённые»", () => {
    expect(columnOf(task({ status: "done" }), [])).toBe("done");
    expect(columnOf(task({ approvalState: "accepted" }), [person({ doneAt: "x" })])).toBe("done");
  });

  it("задача без единого участника остаётся новой, а не уезжает на приёмку", () => {
    // Пустой список исполнителей не означает «все отчитались»: считать так
    // значило бы объявить сделанной задачу, которую никто не делал.
    expect(columnOf(task(), [])).toBe("new");
  });
});

describe("moveBetween", () => {
  const executor = { isAuthor: false, isExecutor: true };
  const author = { isAuthor: true, isExecutor: false };
  const both = { isAuthor: true, isExecutor: true };

  it("исполнитель берёт задачу в работу", () => {
    expect(moveBetween("new", "work", executor)).toEqual({ action: "accept" });
  });

  it("постановщик не принимает задачу за исполнителя", () => {
    expect(moveBetween("new", "work", author)).toHaveProperty("refused");
  });

  it("исполнитель отчитывается переносом на приёмку", () => {
    expect(moveBetween("work", "review", executor)).toEqual({ action: "report" });
  });

  it("отчитаться можно и минуя «В работе»: сделал раньше, чем нажал «Принял»", () => {
    expect(moveBetween("new", "review", executor)).toEqual({ action: "report" });
  });

  it("постановщик принимает работу", () => {
    expect(moveBetween("review", "done", author)).toEqual({ action: "approve" });
  });

  it("минуя приёмку задачу не закрыть", () => {
    expect(moveBetween("work", "done", author)).toHaveProperty("refused");
  });

  // Доска ходит в одну сторону: всё, что назад, — отдельное событие с
  // причиной, и делается оно кнопкой в карточке, а не движением руки.
  it("назад не переносится ничего — ни постановщиком, ни исполнителем", () => {
    expect(moveBetween("review", "work", author)).toHaveProperty("refused");
    expect(moveBetween("done", "work", author)).toHaveProperty("refused");
    expect(moveBetween("done", "review", author)).toHaveProperty("refused");
    expect(moveBetween("review", "new", both)).toHaveProperty("refused");
  });

  it("в «Новые» ничего не возвращается", () => {
    expect(moveBetween("work", "new", both)).toHaveProperty("refused");
  });

  it("перенос в свой же столбец — не перенос", () => {
    expect(moveBetween("work", "work", both)).toBeNull();
  });
});

// Прежде здесь стояло обратное: задача самому себе минует «Новые». Кирилл
// отменил это 22.09.2026, увидев свою только что заведённую задачу сразу в
// «В работе» — «сперва все задачи должны создаваться в колонке „новая
// задача“». Тест остаётся, чтобы исключение не вернулось «как очевидное».
describe("columnOf — задача самому себе", () => {
  it("тоже начинается с «Новых»: исключений у этого столбца нет", () => {
    expect(columnOf(task(), [person()])).toBe("new");
  });

  it("и дальше идёт обычным путём", () => {
    expect(columnOf(task(), [person({ acceptedAt: "x" })])).toBe("work");
    expect(columnOf(task(), [person({ doneAt: "x" })])).toBe("review");
  });
});
