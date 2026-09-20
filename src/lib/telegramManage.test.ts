import { describe, it, expect } from "vitest";
import { taskPatchFor } from "./telegramManage";
import { REOPEN_PATCH } from "./reviewWork";

// Массовые действия над задачей из мессенджера: «отметь выполненной» и
// «верни в работу».
//
// Проверяется здесь, а не только на боевом, по конкретной причине.
// Добраться до этого кода можно лишь фразой, которую разбирает GigaChat, —
// и проверка на боевом краснела ровно тогда, когда модель не узнавала
// фразу. Код при этом был цел. Тест, который иногда красный не по вине
// кода, читается как регрессия и стоит получаса на каждую осечку, так
// что правило проверяется тут, а понимание фразы — прогоном по боевому.

describe("что пишется в задачу", () => {
  it("«выполнена» — это только статус", () => {
    expect(taskPatchFor("complete")).toEqual({ status: "done" });
  });

  it("«верни в работу» снимает ВСЁ, что задачу закрывало", () => {
    // Здесь и была настоящая ошибка: писался один статус, а принятую
    // задачу держит в «Завершённых» ещё и приёмка — снятая галочка не
    // возвращала её никуда.
    expect(taskPatchFor("reopen")).toEqual({ ...REOPEN_PATCH });
  });

  it("и это тот же самый набор колонок, что у трекера и маршрута", () => {
    // Не «похожий»: вторая копия правила в этом проекте расходилась с
    // первой трижды, поэтому сравнение идёт с самим источником.
    const patch = taskPatchFor("reopen")!;
    expect(patch.status).toBe("in_progress");
    expect(patch.approval_state).toBe("open");
    expect(patch.approved_at).toBeNull();
    expect(patch.completed_at).toBeNull();
    expect(patch.force_closed_by).toBeNull();
  });

  it("чужие действия к задаче не применяются", () => {
    // «Прошла успешно» и «без результата» — про встречу; молча превратить
    // их в правку задачи значит закрыть не то, что просили.
    expect(taskPatchFor("success")).toBeNull();
    expect(taskPatchFor("no_result")).toBeNull();
    expect(taskPatchFor("delete")).toBeNull();
  });
});
