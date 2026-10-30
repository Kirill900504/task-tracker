import { describe, expect, it } from "vitest";
import { codeChoices, isLoginAction, isLoginToken, LOGIN_PREFIX, loginButtons, newLoginCode, newLoginToken } from "./messengerLogin";
import { decodeCallback } from "./colleagues";

// Токен входа через бота едет в ссылке t.me/<бот>?start=… и обратно в
// кнопке «Да, войти» — его форма должна пройти обе дороги и не спутаться с
// восьмибуквенным кодом подключения, который разбирает та же дверь.
describe("вход через бота", () => {
  it("токен узнаётся и укладывается в start-параметр и кнопку", () => {
    const token = newLoginToken();
    expect(token.startsWith(LOGIN_PREFIX)).toBe(true);
    expect(isLoginToken(token)).toBe(true);
    // Telegram: start до 64 символов из [A-Za-z0-9_-]; кнопка — до 64 байт.
    expect(token).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(`t:lgok:${token}`.length).toBeLessThanOrEqual(64);
  });

  it("токены не повторяются", () => {
    const seen = new Set(Array.from({ length: 200 }, newLoginToken));
    expect(seen.size).toBe(200);
  });

  it("код подключения и мусор токеном не считаются", () => {
    expect(isLoginToken("ABCD2345")).toBe(false);
    expect(isLoginToken("LOGIN")).toBe(false);
    expect(isLoginToken(newLoginToken().toLowerCase())).toBe(false);
    expect(isLoginToken(newLoginToken() + "A")).toBe(false);
  });

  it("кнопки входа узнаются, чужие — нет", () => {
    expect(isLoginAction({ kind: "task", action: "lgok" })).toBe(true);
    expect(isLoginAction({ kind: "task", action: "lgno" })).toBe(true);
    expect(isLoginAction({ kind: "meeting", action: "lgok" })).toBe(false);
    expect(isLoginAction({ kind: "task", action: "ok" })).toBe(false);
  });

  // Запрос, пришедший в чат сам (lib/loginPush), отвечается числом с экрана
  // входа: верное среди трёх, и кнопка несёт выбранное число обратно.
  it("число для сверки — двузначное, среди трёх разных кнопок", () => {
    for (let i = 0; i < 200; i++) {
      const code = newLoginCode();
      expect(code).toBeGreaterThanOrEqual(10);
      expect(code).toBeLessThanOrEqual(99);
      const choices = codeChoices(code);
      expect(choices).toHaveLength(3);
      expect(new Set(choices).size).toBe(3);
      expect(choices).toContain(code);
    }
  });

  it("кнопки с числом доезжают до разбора и укладываются в 64 байта", () => {
    const token = newLoginToken();
    const rows = loginButtons(token, 47);
    const numbers = rows[0].map((b) => decodeCallback(b.data)!);
    expect(numbers.map((a) => a.action)).toEqual(["lgok", "lgok", "lgok"]);
    expect(numbers.map((a) => a.id)).toContain(`${token}.47`);
    for (const b of rows.flat()) expect(b.data.length).toBeLessThanOrEqual(64);
    expect(decodeCallback(rows[1][0].data)).toMatchObject({ action: "lgno", id: token });
    // Старый запрос без числа — прежние «Да / Нет».
    expect(loginButtons(token, null)[0].map((b) => b.data)).toEqual([`t:lgok:${token}`, `t:lgno:${token}`]);
  });
});
