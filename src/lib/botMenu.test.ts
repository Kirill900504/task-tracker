import { describe, it, expect } from "vitest";
import { botMenu, menuButtons, navRow } from "./botMenu";
import { decodeCallback } from "./colleagues";

// Меню — то место, где ошибка не видна ни типам, ни сборке: кнопка с
// чужим `data` выглядит совершенно нормально и просто не работает, а
// молчащая кнопка неотличима от сломанной. Поэтому проверяется не вид, а
// адресация.

describe("меню бота", () => {
  it("у получателя есть все его разделы, а не две кнопки", () => {
    // Ради этого всё и затевалось. Выборки «сегодня», «просрочено», «на
    // приёмке» были написаны давно — и добраться до них можно было, только
    // угадав слово.
    const labels = menuButtons("recipient")
      .flat()
      .map((b) => b.text)
      .join(" ");
    expect(labels).toContain("Мои задачи");
    expect(labels).toContain("Сегодня");
    expect(labels).toContain("Просрочено");
    expect(labels).toContain("На приёмке");
    expect(labels).toContain("Встречи");
    expect(labels).toContain("Помощь");
  });

  it("у постановщика к тем же разделам добавлены его собственные", () => {
    const labels = menuButtons("assigner")
      .flat()
      .map((b) => b.text)
      .join(" ");
    expect(labels).toContain("Задачи");
    expect(labels).toContain("Сегодня");
    expect(labels).toContain("На приёмке");
    expect(labels).toContain("Люди");
    expect(labels).toContain("Поручить");
  });

  it("получателю не показывают того, чего ему не дадут", () => {
    // «Поручить» и «Люди» разбираются только половиной постановщика.
    // Кнопка, попавшая не в тот чат, молчит — а это читается как поломка
    // бота, а не как отсутствие права.
    const labels = menuButtons("recipient")
      .flat()
      .map((b) => b.text)
      .join(" ");
    expect(labels).not.toContain("Поручить");
    expect(labels).not.toContain("Люди");
  });

  it("каждая кнопка адресована той половине, которая её разбирает", () => {
    // Половина постановщика понимает `olist` / `omenu` / `new`, половина
    // получателя — `list`. Перепутанное здесь означает кнопку, которая
    // ничего не делает у того, кому её показали.
    for (const b of menuButtons("assigner").flat()) {
      const action = decodeCallback(b.data)!.action;
      expect(["olist", "omenu", "new"]).toContain(action);
    }
    for (const b of menuButtons("recipient").flat()) {
      expect(decodeCallback(b.data)!.action).toBe("list");
    }
  });

  it("ни одна кнопка не длиннее того, что примет Telegram", () => {
    // 64 байта на callback_data — не рекомендация: длиннее API отвергает
    // всё сообщение целиком, и человек не получает вообще ничего.
    for (const who of ["assigner", "recipient"] as const) {
      for (const b of [...menuButtons(who).flat(), ...navRow(who).flat()]) {
        expect(Buffer.byteLength(b.data, "utf8")).toBeLessThanOrEqual(64);
        expect(decodeCallback(b.data)).not.toBeNull();
      }
    }
  });

  it("из любого списка есть выход в меню, у обеих половин", () => {
    for (const who of ["assigner", "recipient"] as const) {
      expect(navRow(who).flat().map((b) => b.text).join(" ")).toContain("Меню");
    }
  });

  it("меню спрашивает, а не рассказывает", () => {
    expect(botMenu("recipient").text).toBe("Что показать?");
    expect(botMenu("recipient").buttons.length).toBeGreaterThan(1);
  });
});
