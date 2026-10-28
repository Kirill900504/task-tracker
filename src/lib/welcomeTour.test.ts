import { describe, expect, it } from "vitest";
import { shouldShowTour, tourSteps } from "./welcomeTour";

const NOW = new Date("2026-10-28T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

describe("стартовое знакомство — кому показывать", () => {
  it("новому человеку — да", () => {
    expect(shouldShowTour({ createdAt: new Date(NOW - DAY).toISOString(), done: false, now: NOW, automated: false })).toBe(true);
  });

  it("второй раз — нет, отметка в учётной записи", () => {
    expect(shouldShowTour({ createdAt: new Date(NOW - DAY).toISOString(), done: true, now: NOW, automated: false })).toBe(false);
  });

  it("тому, кто в трекере давно, — не навязываем", () => {
    expect(shouldShowTour({ createdAt: new Date(NOW - 60 * DAY).toISOString(), done: false, now: NOW, automated: false })).toBe(false);
  });

  it("автотестам — нет, иначе окно легло бы поверх каждого теста", () => {
    expect(shouldShowTour({ createdAt: new Date(NOW - DAY).toISOString(), done: false, now: NOW, automated: true })).toBe(false);
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
