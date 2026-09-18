import { describe, it, expect } from "vitest";
import { listReply, markFor, matchColleagueCommand, type MyTask } from "./colleagueQueries";

const TODAY = "2026-09-18";

function task(patch: Partial<MyTask> = {}): MyTask {
  return {
    participantId: "p1",
    taskId: "t1",
    title: "Свести остатки",
    description: "",
    deadline: "",
    priority: "med",
    role: "executor",
    acceptedAt: null,
    doneAt: null,
    declinedAt: null,
    approvalState: "open",
    approvalComment: "",
    ...patch,
  };
}

describe("команды коллеги", () => {
  it("понимает вопрос, ради которого всё затевалось", () => {
    // До сих пор «мои задачи» уходило комментарием в чужую карточку: команд
    // у коллеги не было вовсе.
    expect(matchColleagueCommand("мои задачи")).toBe("tasks");
    expect(matchColleagueCommand("Просрочено")).toBe("overdue");
    expect(matchColleagueCommand("встречи?")).toBe("meetings");
    expect(matchColleagueCommand("на приёмке")).toBe("review");
    // Буква ё набирается не у всех и не всегда.
    expect(matchColleagueCommand("на приемке")).toBe("review");
  });

  it("не проглатывает сообщение, в котором команда — просто слово", () => {
    // Совпадение точное именно поэтому: «сегодня» внутри фразы — это слово,
    // и ответить на него списком значит потерять то, что человек написал.
    expect(matchColleagueCommand("сегодня не успею, завтра сделаю")).toBeNull();
    expect(matchColleagueCommand("задачи по рознице обсудим в четверг")).toBeNull();
    expect(matchColleagueCommand("")).toBeNull();
  });
});

describe("список задач в мессенджере", () => {
  it("на каждой задаче — кнопка, которой по ней отвечают", () => {
    // Список без кнопок — это сообщение о том, сколько накопилось, а
    // ответить из него нельзя: пришлось бы искать в переписке то сообщение,
    // которым задачу присылали.
    const reply = listReply("📋 Ваши задачи", [task(), task({ taskId: "t2", title: "Смета" })], TODAY, "пусто");
    const data = (reply.buttons || []).flat().map((b) => b.data);
    expect(data).toContain("t:show:t1");
    expect(data).toContain("t:show:t2");
  });

  it("под любым списком есть переход в другой", () => {
    // Иначе из «просрочено» во «встречи» можно попасть только словом, а
    // человек к этому моменту уже листает переписку вверх.
    const reply = listReply("⚠ Просрочено", [task()], TODAY, "пусто");
    const data = (reply.buttons || []).flat().map((b) => b.data);
    expect(data).toContain("t:list:my");
    expect(data).toContain("m:list:my");
  });

  it("пустой список — это ответ, а не молчание", () => {
    const reply = listReply("⚠ Просрочено", [], TODAY, "Просроченного за вами нет 👍");
    expect(reply.text).toContain("нет");
    expect((reply.buttons || []).flat().map((b) => b.data)).toContain("t:list:my");
  });

  it("длинный список обрывается и говорит об этом", () => {
    const many = Array.from({ length: 11 }, (_, i) => task({ taskId: "t" + i, title: "Задача " + i }));
    const reply = listReply("📋 Ваши задачи", many, TODAY, "пусто");
    expect(reply.text).toContain("(11)");
    expect(reply.text).toContain("И ещё 3");
    // Кнопок ровно столько же, сколько строк, плюс ряд перехода.
    expect((reply.buttons || []).length).toBe(8 + 1);
  });

  it("называет роль, потому что от неё зависит, ждут ли ответа", () => {
    const reply = listReply("📋", [task({ role: "watcher" })], TODAY, "пусто");
    expect(reply.text).toContain("наблюдатель");
  });
});

describe("значок состояния", () => {
  it("возврат на доработку важнее отчёта", () => {
    // Человек отчитался, работу вернули — ждут снова его. Показать «🏁» тут
    // значит сказать, что дело сделано.
    expect(markFor(task({ doneAt: "2026-09-17", approvalState: "returned" }), TODAY)).toBe("↩");
  });

  it("отказ виден прежде срока", () => {
    expect(markFor(task({ declinedAt: "2026-09-17", deadline: "2026-09-01" }), TODAY)).toBe("⛔");
  });

  it("просроченное отличается от сегодняшнего и от нового", () => {
    expect(markFor(task({ deadline: "2026-09-01" }), TODAY)).toBe("⚠");
    expect(markFor(task({ deadline: TODAY }), TODAY)).toBe("●");
    expect(markFor(task(), TODAY)).toBe("🆕");
    expect(markFor(task({ acceptedAt: "2026-09-17" }), TODAY)).toBe("•");
  });
});
