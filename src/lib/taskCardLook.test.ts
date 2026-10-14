import { describe, expect, it } from "vitest";
import { cardKind } from "./taskCardKind";
import { dueInfo } from "./dueLabel";
import { personState, shortName, initialsOf } from "./personBadge";

describe("cardKind — чем задача является для меня", () => {
  // Главная ошибка прежнего вида: фирменная заливка шла исполнителю, и
  // горели задачи самому себе, а поручения другим стояли серыми.
  it("поручение другим — фирменное, даже если я ещё и помогаю", () => {
    expect(cardKind({ authored: true, selfTask: false, role: "none" })).toBe("outgoing");
    expect(cardKind({ authored: true, selfTask: false, role: "coexecutor" })).toBe("outgoing");
    expect(cardKind({ authored: true, selfTask: false, role: "executor" })).toBe("outgoing");
  });

  it("задача самому себе — своя отметка, а не фирменная", () => {
    expect(cardKind({ authored: true, selfTask: true, role: "executor" })).toBe("self");
  });

  it("поручили мне, помогаю, смотрю — три разных вида", () => {
    expect(cardKind({ authored: false, selfTask: false, role: "executor" })).toBe("incoming");
    expect(cardKind({ authored: false, selfTask: false, role: "coexecutor" })).toBe("co");
    expect(cardKind({ authored: false, selfTask: false, role: "watcher" })).toBe("watch");
    expect(cardKind({ authored: false, selfTask: false, role: "none" })).toBe("none");
  });
});

describe("dueInfo — срок словами", () => {
  const today = "2026-10-13";
  it("считает остаток и пишет месяц словом", () => {
    expect(dueInfo("2026-10-19", { today })).toEqual({ text: "До 19 окт · 6 дн.", tone: "normal", title: "Срок: 19.10.2026 — осталось 6 дн." });
  });
  it("далёкий срок — без остатка, чужой год — с годом", () => {
    expect(dueInfo("2026-12-31", { today })!.text).toBe("До 31 дек");
    expect(dueInfo("2027-01-05", { today })!.text).toBe("До 5 янв 2027");
  });
  it("сегодня, завтра и просрочка — своими словами и тоном", () => {
    expect(dueInfo("2026-10-13", { today })).toMatchObject({ text: "Сегодня", tone: "today" });
    expect(dueInfo("2026-10-14", { today })).toMatchObject({ text: "Завтра", tone: "soon" });
    expect(dueInfo("2026-10-10", { today })).toMatchObject({ text: "Просрочено 3 дн.", tone: "late" });
  });
  it("«скоро» решает тот, кто знает рабочие дни", () => {
    expect(dueInfo("2026-10-15", { today, soon: true })!.tone).toBe("soon");
    expect(dueInfo("2026-10-15", { today, soon: false })!.tone).toBe("normal");
  });
  it("пустой или кривой срок — ничего", () => {
    expect(dueInfo("", { today })).toBeNull();
    expect(dueInfo("завтра", { today })).toBeNull();
  });
});

describe("personState — кто на каком этапе", () => {
  const t = "2026-10-12T10:00:00Z";
  it("отчёт сильнее всего, отказ сильнее «принял»", () => {
    expect(personState({ doneAt: t, declinedAt: t, acceptedAt: t })).toBe("done");
    expect(personState({ doneAt: null, declinedAt: t, acceptedAt: t })).toBe("declined");
    expect(personState({ doneAt: null, declinedAt: null, acceptedAt: t })).toBe("working");
    expect(personState({ doneAt: null, declinedAt: null, acceptedAt: null })).toBe("waiting");
  });
  it("без мессенджера — не «ждём», а «не дошло»", () => {
    expect(personState({ doneAt: null, declinedAt: null, acceptedAt: null, reachable: false })).toBe("unreachable");
  });
});

describe("имя коротко", () => {
  it("имя и буква фамилии, без «(я)»", () => {
    expect(shortName("Никита Козлов")).toBe("Никита К.");
    expect(shortName("Кирилл Кучеренко (я)")).toBe("Кирилл К.");
    expect(shortName("Аня")).toBe("Аня");
    expect(initialsOf("Кирилл Кучеренко (я)")).toBe("КК");
  });
});
