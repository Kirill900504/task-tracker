import { describe, it, expect } from "vitest";
import { effectiveApproval, ownerMenu, ownerNav, peopleLoadReply, type OwnerTaskRow } from "./ownerQueries";
import { addDays, EXTEND_OPTIONS, extendButtons } from "./ownerReplies";
import { resolveWhen, startNewTask, whenButtons } from "./ownerNewTask";

function task(extra: Partial<OwnerTaskRow> & { recurKind?: string } = {}): OwnerTaskRow {
  const { recurKind = "none", ...rest } = extra;
  const merged = { id: "t1", title: "Задача", assignee: "Аня", deadline: null as string | null, status: "in_progress", approvalState: "open", priority: "med", ...rest };
  return {
    ...merged,
    row: rest.row ?? {
      id: merged.id, title: merged.title, assignee: merged.assignee, status: merged.status || "", deadline: merged.deadline,
      recur: recurKind, recur_weekday: null, recur_weekdays: null, recur_monthday: null, recur_year_day: null, recur_year_month: null,
    },
  };
}

describe("меню владельца", () => {
  it("носит кнопку на каждый вопрос, который он задаёт боту чаще всего", () => {
    const labels = ownerMenu()
      .buttons!.flat()
      .map((b) => b.text);
    expect(labels.join(" ")).toContain("Задачи");
    expect(labels.join(" ")).toContain("Сегодня");
    expect(labels.join(" ")).toContain("Просрочено");
    expect(labels.join(" ")).toContain("На приёмке");
    expect(labels.join(" ")).toContain("Встречи");
    expect(labels.join(" ")).toContain("Поручить");
  });

  it("а нижний ряд любого экрана возвращает в меню", () => {
    // Без этого каждый список — тупик, из которого выходят прокруткой
    // переписки назад.
    expect(ownerNav().flat().map((b) => b.text).join(" ")).toContain("Меню");
  });
});

describe("загрузка людей", () => {
  const today = "2026-09-21";

  it("считает просроченное отдельно от того, что ждёт приёмки", () => {
    const reply = peopleLoadReply(
      [
        task({ assignee: "Аня", deadline: "2026-09-10" }),
        task({ id: "t2", assignee: "Аня", approvalState: "awaiting_review" }),
        task({ id: "t3", assignee: "Борис" }),
      ],
      today,
    );
    expect(reply.text).toContain("Аня");
    expect(reply.text).toContain("1 просрочено");
    expect(reply.text).toContain("1 на приёмке");
    expect(reply.text).toContain("Борис");
  });

  it("сверху тот, у кого горит", () => {
    const reply = peopleLoadReply(
      [task({ assignee: "Спокойный" }), task({ id: "t2", assignee: "Горящий", deadline: "2026-09-01" })],
      today,
    );
    expect(reply.text.indexOf("Горящий")).toBeLessThan(reply.text.indexOf("Спокойный"));
  });

  it("молчит, когда поручать было некому", () => {
    expect(peopleLoadReply([], today).text).toContain("Никому ничего не поручено");
  });
});

describe("продление срока", () => {
  it("считает от текущего срока, а не от сегодня", () => {
    expect(addDays("2026-09-30", 3)).toBe("2026-10-03");
  });

  it("перешагивает конец месяца и года", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("предлагает четыре шага и выход", () => {
    const rows = extendButtons("t1");
    expect(rows.flat()).toHaveLength(EXTEND_OPTIONS.length + 1);
    expect(rows.flat().at(-1)!.text).toContain("Отмена");
  });
});

describe("мастер «Поручить»", () => {
  // Понедельник 21.09.2026 — точка отсчёта.
  const monday = new Date("2026-09-21T09:00:00");

  it("«до пятницы» — ближайшая пятница", () => {
    expect(resolveWhen("fri", monday)).toBe("2026-09-25");
  });

  it("а сказанное в пятницу означает следующую: сегодня уже поздно", () => {
    expect(resolveWhen("fri", new Date("2026-09-25T09:00:00"))).toBe("2026-10-02");
  });

  it("считает «сегодня», «завтра» и «через неделю»", () => {
    expect(resolveWhen("0", monday)).toBe("2026-09-21");
    expect(resolveWhen("1", monday)).toBe("2026-09-22");
    expect(resolveWhen("7", monday)).toBe("2026-09-28");
  });

  // «Без срока» больше нет — срок обязателен (14.10.2026). Нажатие такой
  // кнопки в старом сообщении даёт срок по умолчанию: неделю.
  it("старая кнопка «без срока» ставит неделю", () => {
    expect(resolveWhen("no", monday)).not.toBe("");
  });

  it("первый шаг спрашивает, что поручить, а не кому", () => {
    // Порядок шагов — от сути к деталям: формулировку можно надиктовать,
    // а держать её в голове, пока листаешь список людей, не надо.
    expect(startNewTask().text).toContain("Что поручить");
    expect(startNewTask().pending.stage).toBe("title");
  });

  it("сроки предлагаются кнопками, и «без срока» среди них нет", () => {
    const labels = whenButtons().flat().map((b) => b.text);
    expect(labels).toContain("Сегодня");
    expect(labels).toContain("До пятницы");
    expect(labels).not.toContain("Без срока");
  });
});

// Повторяющаяся задача не бывает просроченной — ни на доске, ни в боте
// (taskLogic.overdueOn). 14.10.2026 ежедневная #75 с датой первого круга
// 24.09 висела в боте «просроченной», а на доске — нет.
describe("просрочка в боте — по правилу доски", () => {
  it("ежедневная задача с давней датой не просрочена", () => {
    const reply = peopleLoadReply([task({ deadline: "2026-09-24", recurKind: "daily" })], "2026-10-14");
    expect(reply.text).not.toContain("просроч");
  });
  it("разовая с прошедшим сроком — просрочена", () => {
    const reply = peopleLoadReply([task({ deadline: "2026-09-24" })], "2026-10-14");
    expect(reply.text).toContain("просроч");
  });
});

describe("«на приёмке» в боте — по правилу доски", () => {
  it("ответили все исполнители — приёмка, даже без отметки", () => {
    expect(effectiveApproval("open", [{ role: "executor", done_at: "x", declined_at: null }, { role: "coexecutor", done_at: null, declined_at: null }])).toBe("awaiting_review");
  });
  it("ответили не все — нет", () => {
    expect(effectiveApproval("open", [{ role: "executor", done_at: "x", declined_at: null }, { role: "executor", done_at: null, declined_at: null }])).toBe("open");
  });
  it("возвращённая остаётся в работе, исполнителей нет — нет", () => {
    expect(effectiveApproval("returned", [{ role: "executor", done_at: "x", declined_at: null }])).toBe("returned");
    expect(effectiveApproval("open", [])).toBe("open");
  });
});
