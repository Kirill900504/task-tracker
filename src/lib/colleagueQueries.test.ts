import { describe, it, expect } from "vitest";
import { listReply, markFor, matchColleagueCommand, replyForColleague, type MyTask } from "./colleagueQueries";
import { decodeCallback } from "./colleagues";

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

  it("под любым списком есть выход в меню", () => {
    // Раньше здесь стоял переход «задачи ⇄ встречи», и он же был потолком:
    // два раздела ходили друг в друга, а «сегодня», «просрочено» и «на
    // приёмке» существовали, только если угадать слово. Дверь в меню
    // открывает все разделы разом.
    const reply = listReply("⚠ Просрочено", [task()], TODAY, "пусто");
    const data = (reply.buttons || []).flat().map((b) => b.data);
    expect(data).toContain("t:list:menu");
    expect(data).toContain("t:list:my");
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

// «☰ Меню» с кнопки получателя у постановщика. 13.10.2026 Кирилл нажал в
// нём «На приёмке» и получил «Ничего не ждёт приёмки» при задаче, стоящей
// у него на приёмке: открылось меню получателя, где этот раздел — «что
// сдал я сам». Меню выбирается по человеку, а не по кнопке.
describe("меню по роли", () => {
  function adminWith(member: { status: string; member_id: string | null } | null) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: member, error: null }),
    };
    return { from: () => chain } as unknown as Parameters<typeof replyForColleague>[0];
  }
  const actions = (reply: { buttons?: { data: string }[][] }) =>
    (reply.buttons || []).flat().map((b) => decodeCallback(b.data)?.action);

  it("владельцу — меню постановщика", async () => {
    const reply = await replyForColleague(adminWith(null), { id: "a", name: "Кирилл Кучеренко (я)" }, "menu", TODAY);
    expect(actions(reply)).toContain("olist");
  });

  it("человеку со входом — тоже", async () => {
    const reply = await replyForColleague(adminWith({ status: "active", member_id: "u" }), { id: "a", name: "Михаил Котов" }, "menu", TODAY);
    expect(actions(reply)).toContain("olist");
  });

  it("получателю без входа — его меню, без чужих разделов", async () => {
    const reply = await replyForColleague(adminWith(null), { id: "a", name: "Юрий Черкашин" }, "menu", TODAY);
    expect(actions(reply)).not.toContain("olist");
  });
});

describe("справка по роли", () => {
  function adminWith(member: { status: string; member_id: string | null } | null) {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: member, error: null }) };
    return { from: () => chain } as unknown as Parameters<typeof replyForColleague>[0];
  }
  it("постановщику — его справка, получателю — своя", async () => {
    const boss = await replyForColleague(adminWith({ status: "active", member_id: "u" }), { id: "a", name: "Михаил Котов" }, "help", TODAY);
    const plain = await replyForColleague(adminWith(null), { id: "a", name: "Юрий Черкашин" }, "help", TODAY);
    expect(boss.text).not.toBe(plain.text);
    expect((boss.buttons || []).flat().map((b) => decodeCallback(b.data)?.action)).toContain("omenu");
  });
});
