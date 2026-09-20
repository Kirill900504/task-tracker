import { describe, it, expect } from "vitest";
import { composeManagerBrief, managerBriefIsEmpty, type ManagerBriefFacts } from "./managerBrief";

function facts(patch: Partial<ManagerBriefFacts> = {}): ManagerBriefFacts {
  return {
    name: "Игорь",
    overdue: [],
    today: [],
    unanswered: [],
    meetings: [],
    returned: [],
    discussed: [],
    together: [],
    ...patch,
  };
}

describe("утренняя сводка руководителю", () => {
  it("порядок продиктован тем, что делать раньше", () => {
    const text = composeManagerBrief(
      facts({
        overdue: [{ title: "Смета", deadline: "2026-09-10" }],
        today: [{ title: "Остатки", deadline: "2026-09-18" }],
        unanswered: [{ title: "Заявка" }],
        meetings: [{ title: "Планёрка", time: "10:00" }],
      }),
    );
    expect(text.indexOf("Просрочено")).toBeLessThan(text.indexOf("Сегодня"));
    expect(text.indexOf("Сегодня")).toBeLessThan(text.indexOf("Ждут вашего ответа"));
  });

  it("говорит, где без него писали", () => {
    // Раньше не говорила вовсе: Кирилл писал в обсуждении задачи, и человек
    // не узнавал об этом никогда — ни сразу, ни утром.
    const text = composeManagerBrief(facts({ discussed: [{ title: "Смета на сентябрь" }] }));
    expect(text).toContain("Писали в обсуждениях");
    expect(text).toContain("Смета на сентябрь");
  });

  it("обсуждения идут последними — это чтение, а не дело", () => {
    const text = composeManagerBrief(
      facts({ overdue: [{ title: "Смета", deadline: "2026-09-10" }], discussed: [{ title: "Остатки" }] }),
    );
    expect(text.indexOf("Просрочено")).toBeLessThan(text.indexOf("Писали в обсуждениях"));
  });

  // Задача на двоих закрывается, когда отчитались оба, — значит отказ
  // напарника касается второго напрямую: он ждёт закрытия, которого не
  // будет. Сообщением это не шлётся (задача на четверых дала бы каждому
  // по три уведомления о чужих ответах), строкой в сводке — шлётся.
  it("говорит, что сделали напарники по общим задачам", () => {
    const text = composeManagerBrief(
      facts({ together: [{ title: "Смета", note: "Черкашин отчитался; Петров не может" }] }),
    );
    expect(text).toContain("Вместе с вами");
    expect(text).toContain("Черкашин отчитался; Петров не может");
  });

  it("общие задачи идут до обсуждений: это ещё работа, а не чтение", () => {
    const text = composeManagerBrief(
      facts({ together: [{ title: "Смета", note: "Черкашин отчитался" }], discussed: [{ title: "Остатки" }] }),
    );
    expect(text.indexOf("Вместе с вами")).toBeLessThan(text.indexOf("Писали в обсуждениях"));
  });

  it("сводка с одним лишь обсуждением всё-таки уходит", () => {
    // Пустой её считать нельзя: иначе единственное, что случилось за сутки,
    // человек не увидит.
    expect(managerBriefIsEmpty(facts({ discussed: [{ title: "Смета" }] }))).toBe(false);
    expect(managerBriefIsEmpty(facts())).toBe(true);
  });
});
