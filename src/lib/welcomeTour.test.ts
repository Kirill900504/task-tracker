import { describe, expect, it } from "vitest";
import { TOUR_VERSION, seenTourVersion, shouldShowTour, tourSteps } from "./welcomeTour";

describe("стартовое знакомство — кому показывать", () => {
  it("кто не видел — да, и новым, и давним", () => {
    expect(shouldShowTour({ seenVersion: seenTourVersion({}), automated: false })).toBe(true);
  });

  it("прошёл первую версию — увидит нынешнюю ещё раз", () => {
    expect(seenTourVersion({ tour_done: true })).toBe(1);
    expect(shouldShowTour({ seenVersion: seenTourVersion({ tour_done: true }), automated: false })).toBe(true);
  });

  it("прошёл нынешнюю — больше не показываем, на любом устройстве", () => {
    expect(shouldShowTour({ seenVersion: seenTourVersion({ tour_done: true, tour_version: TOUR_VERSION }), automated: false })).toBe(false);
  });

  it("автотестам — нет, иначе окно легло бы поверх каждого теста", () => {
    expect(shouldShowTour({ seenVersion: 0, automated: true })).toBe(false);
  });
});

describe("стартовое знакомство — шаги", () => {
  it("«Команда» — только владельцу: у остальных такой кнопки нет", () => {
    expect(tourSteps({ isOwner: true }).some((s) => s.id === "team")).toBe(true);
    expect(tourSteps({ isOwner: false }).some((s) => s.id === "team")).toBe(false);
  });

  it("начинается приветствием и кончается «Моими данными»", () => {
    const steps = tourSteps({ isOwner: false });
    expect(steps[0].id).toBe("hello");
    expect(steps[steps.length - 1].id).toBe("done");
    expect(steps[steps.length - 1].text.join(" ")).toContain("Мои данные");
  });

  it("«Мысли» объясняют, чем «Отправить» отличается от «Поделиться»", () => {
    const ideas = tourSteps({ isOwner: false }).find((s) => s.id === "ideas")!;
    const labels = (ideas.points || []).map((p) => p.label);
    expect(labels).toEqual(expect.arrayContaining(["Создать", "Отправить", "Поделиться"]));
  });

  it("у каждого шага есть слова", () => {
    for (const s of tourSteps({ isOwner: true })) expect(s.text.join("").length).toBeGreaterThan(20);
  });
});
