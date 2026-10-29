import { describe, expect, it } from "vitest";
import { isLoginAction, isLoginToken, LOGIN_PREFIX, newLoginToken } from "./messengerLogin";

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
});
