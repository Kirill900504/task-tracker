import { describe, it, expect } from "vitest";
import { composeSilence, groupSilent, type SilentRow } from "./silence";

const now = new Date("2026-09-15T09:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function row(name: string, title: string, days: number): SilentRow {
  return { name, title, since: daysAgo(days) };
}

describe("кто молчит", () => {
  it("складывает задачи одного человека в одну строку", () => {
    const [only] = groupSilent([row("Игорь", "Смета", 3), row("Игорь", "Остатки", 2)], now);
    expect(only.name).toBe("Игорь");
    expect(only.count).toBe(2);
    // Считается по самой старой: она и говорит, сколько это тянется.
    expect(only.days).toBe(3);
    expect(only.oldest).toBe("Смета");
  });

  it("первым идёт тот, кто молчит дольше", () => {
    const people = groupSilent([row("Никита", "Отчёт", 2), row("Игорь", "Смета", 6)], now);
    expect(people.map((p) => p.name)).toEqual(["Игорь", "Никита"]);
  });

  it("при равном сроке впереди тот, у кого задач больше", () => {
    const people = groupSilent([row("Никита", "А", 3), row("Игорь", "Б", 3), row("Игорь", "В", 3)], now);
    expect(people[0].name).toBe("Игорь");
  });

  it("строка называет человека, срок и задачу", () => {
    const text = composeSilence(groupSilent([row("Игорь Витковский", "Собрать смету", 4)], now));
    expect(text).toContain("Игорь Витковский");
    expect(text).toContain("4 дн.");
    expect(text).toContain("Собрать смету");
    // Одна задача — без «задач: 1», это ничего не добавляет.
    expect(text).not.toContain("задач:");
  });

  it("несколько задач — количество названо", () => {
    const text = composeSilence(groupSilent([row("Игорь", "А", 3), row("Игорь", "Б", 3)], now));
    expect(text).toContain("задач: 2");
  });

  it("молчащих нет — нет и строки", () => {
    expect(composeSilence(groupSilent([], now))).toBe("");
  });

  it("длинный список обрезается, но счётчик говорит правду", () => {
    const many = ["А", "Б", "В", "Г", "Д", "Е", "Ж"].map((n) => row(n, "дело", 3));
    const text = composeSilence(groupSilent(many, now));
    expect(text).toContain("(7)");
    expect(text.split("\n").length).toBe(6); // заголовок и пять строк
  });
});
