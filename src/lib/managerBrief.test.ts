import { describe, it, expect } from "vitest";
import { composeManagerBrief, managerBriefIsEmpty, type ManagerBriefFacts } from "./managerBrief";

function facts(patch: Partial<ManagerBriefFacts> = {}): ManagerBriefFacts {
  return {
    name: "Игорь",
    date: "2026-10-28",
    overdue: [],
    today: [],
    soon: [],
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
    expect(text.indexOf("ПРОСРОЧЕНО")).toBeLessThan(text.indexOf("СЕГОДНЯ"));
    expect(text.indexOf("СЕГОДНЯ")).toBeLessThan(text.indexOf("ЖДУТ ВАШЕГО ОТВЕТА"));
  });

  it("говорит, где без него писали", () => {
    // Раньше не говорила вовсе: Кирилл писал в обсуждении задачи, и человек
    // не узнавал об этом никогда — ни сразу, ни утром.
    const text = composeManagerBrief(facts({ discussed: [{ title: "Смета на сентябрь" }] }));
    expect(text).toContain("ПИСАЛИ В ОБСУЖДЕНИЯХ");
    expect(text).toContain("Смета на сентябрь");
  });

  it("обсуждения идут последними — это чтение, а не дело", () => {
    const text = composeManagerBrief(
      facts({ overdue: [{ title: "Смета", deadline: "2026-09-10" }], discussed: [{ title: "Остатки" }] }),
    );
    expect(text.indexOf("ПРОСРОЧЕНО")).toBeLessThan(text.indexOf("ПИСАЛИ В ОБСУЖДЕНИЯХ"));
  });

  // Задача на двоих закрывается, когда отчитались оба, — значит отказ
  // напарника касается второго напрямую: он ждёт закрытия, которого не
  // будет. Сообщением это не шлётся (задача на четверых дала бы каждому
  // по три уведомления о чужих ответах), строкой в сводке — шлётся.
  it("говорит, что сделали напарники по общим задачам", () => {
    const text = composeManagerBrief(
      facts({ together: [{ title: "Смета", note: "Черкашин отчитался; Петров не может" }] }),
    );
    expect(text).toContain("ВМЕСТЕ С ВАМИ");
    expect(text).toContain("Черкашин отчитался; Петров не может");
  });

  it("общие задачи идут до обсуждений: это ещё работа, а не чтение", () => {
    const text = composeManagerBrief(
      facts({ together: [{ title: "Смета", note: "Черкашин отчитался" }], discussed: [{ title: "Остатки" }] }),
    );
    expect(text.indexOf("ВМЕСТЕ С ВАМИ")).toBeLessThan(text.indexOf("ПИСАЛИ В ОБСУЖДЕНИЯХ"));
  });

  it("без горящих сроков сводка не уходит, что бы в ней ни было", () => {
    // 28.10.2026: утреннее сообщение — только когда просрочено или
    // подходит срок.
    expect(managerBriefIsEmpty(facts({ discussed: [{ title: "Смета" }], unanswered: [{ title: "А" }] }))).toBe(true);
    expect(managerBriefIsEmpty(facts({ overdue: [{ title: "А", deadline: "2026-10-01" }] }))).toBe(false);
    expect(managerBriefIsEmpty(facts())).toBe(true);
  });
});

// Сводка выходит дважды в неделю (07.10.2026) и предупреждает о сроках до
// следующей — иначе срок во вторник не попал бы ни в одну.
describe("ближайшие сроки в сводке", () => {
  it("идут блоком «Скоро срок» по возрастанию даты", () => {
    const text = composeManagerBrief(facts({ soon: [{ title: "Б", deadline: "2026-10-30" }, { title: "А", deadline: "2026-10-29" }] }));
    expect(text).toContain("⏳ СКОРО СРОК · 2");
    expect(text.indexOf("▫️ А")).toBeLessThan(text.indexOf("▫️ Б"));
    expect(text).toContain("📅 завтра");
    expect(text).toContain("📅 пт 30.10, через 2 дн.");
  });
  it("одних ближайших сроков достаточно, чтобы сводка ушла", () => {
    expect(managerBriefIsEmpty(facts({ soon: [{ title: "А", deadline: "2026-10-08" }] }))).toBe(false);
  });
});

// Вид «карточки» — выбран 28.10.2026 из трёх вариантов.
describe("вид сводки", () => {
  it("раздел с числом, задача строкой, срок строкой под ней", () => {
    const text = composeManagerBrief(facts({ overdue: [{ title: "#130 Смета", deadline: "2026-10-22" }] }));
    expect(text.startsWith("☀️ Доброе утро, Игорь!")).toBe(true);
    expect(text).toContain(["🔥 ПРОСРОЧЕНО · 1", "━━━━━━━━━━━━", "▪️ #130 Смета", "      ⌛ срок был чт 22.10 · 6 дн. назад"].join("\n"));
    expect(text.endsWith("Хорошего дня! 💪")).toBe(true);
  });
  it("длинное название режется многоточием", () => {
    const text = composeManagerBrief(facts({ today: [{ title: "#148 " + "а".repeat(200), deadline: "2026-10-28" }] }));
    const line = text.split("\n").find((l) => l.startsWith("▪️ #148"))!;
    expect(line.endsWith("…")).toBe(true);
    expect(line.length).toBeLessThan(70);
  });
});
