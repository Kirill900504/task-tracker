import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Корешок роли — правило, которое однажды оказалось написанным и
// невидимым.
//
// 21.09.2026 Кирилл завёл задачу на себя и сказал: «никаких признаков
// отличия там где я соисполнитель и наблюдатель». Код при этом работал:
// класс проставлялся, правило в CSS стояло, роль считалась верно. Не
// работали ЦВЕТА. Соисполнителю доставалась рамка --line (#445157), тогда
// как обычная карточка рисуется --line-soft — rgba(255,255,255,.09) поверх
// #2E383C, то есть #414A4E: тот же цвет с точностью до трёх единиц.
// Наблюдателю доставался светлый фон вместе с opacity .72, а прозрачность
// смешивала его обратно с подложкой.
//
// Такую ошибку нельзя увидеть чтением — «другой цвет» в коде выглядит как
// другой цвет, — и её не ловит ни один тест интерфейса: разметка-то верная.
// Поэтому здесь считается то, что видит глаз: насколько далеко цвета
// корешка друг от друга и не гасит ли их прозрачность.

const css = readFileSync(resolve(__dirname, "../app/tracker.css"), "utf8");

function variable(name: string): string {
  const found = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!found) throw new Error(`переменной --${name} нет в tracker.css`);
  return found[1];
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

// Насколько два цвета различимы. Сумма модулей по каналам — грубая мера, и
// нарочно грубая: точный ΔE здесь дал бы точность, которой нет у самого
// вопроса. Порог подобран по тому, что различалось и что нет: три единицы
// (соисполнитель против обычной карточки) не видел никто.
function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

describe("корешок роли на карточке", () => {
  const bars = {
    исполнитель: variable("role-bar-exec"),
    соисполнитель: variable("role-bar-co"),
    наблюдатель: variable("role-bar-watch"),
    "просрочено у другого": variable("role-bar-late"),
  };

  const pairs = Object.entries(bars).flatMap(([nameA, a], i) =>
    Object.entries(bars)
      .slice(i + 1)
      .map(([nameB, b]) => [`${nameA} ↔ ${nameB}`, a, b] as const),
  );

  it.each(pairs)("%s — это разные цвета", (_label, a, b) => {
    expect(distance(a, b)).toBeGreaterThanOrEqual(30);
  });

  it("корешок «я ни при чём» почти не виден, но существует", () => {
    // Полоска у чужой задачи есть всегда — иначе карточки стояли бы с
    // разным отступом слева и список читался бы рваным. Но она должна
    // молчать: белый с прозрачностью в семь процентов.
    const none = css.match(/--role-bar-none\s*:\s*rgba\(255,\s*255,\s*255,\s*\.0\d\)/);
    expect(none, "--role-bar-none должен быть едва заметным белым").toBeTruthy();
  });

  it("роль не красится прозрачностью", () => {
    // opacity на тёмном фоне не приглушает, а СМЕШИВАЕТ с подложкой, то
    // есть стирает ровно тот тон, ради которого правило написано. Ровно
    // так исчез наблюдатель.
    const rules = css.match(/\.(task\.role-[a-z]+|rb-[a-z]+)\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toMatch(/opacity/);
  });

  it("левый край отдан роли, а не сроку", () => {
    // border-left у просроченной карточки лёг бы поверх корешка, и две
    // полосы слились бы в одну широкую непонятного цвета.
    const overdue = css.match(/\.task\.overdue\{[^}]*\}/)?.[0] || "";
    const dueToday = css.match(/\.task\.due-today\{[^}]*\}/)?.[0] || "";
    expect(overdue).not.toMatch(/border-left/);
    expect(dueToday).not.toMatch(/border-left/);
  });
});
