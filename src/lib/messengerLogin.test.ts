import { describe, expect, it } from "vitest";
import { codeChoices, deviceOf, isLoginAction, isLoginToken, LOGIN_PREFIX, loginButtons, loginPromptText, newLoginCode, newLoginToken } from "./messengerLogin";
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

// Аудит 30.10.2026: вопрос «это вы?» говорил только «новое устройство»,
// и человек, который ничего не открывал, не мог отличить чужой вход от
// своего — а одно число из трёх наугад угадывается в трети случаев.
describe("вопрос о входе называет устройство и время", () => {
  it("браузер и система словами", () => {
    expect(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Chrome · Windows");
    expect(deviceOf("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge · Windows");
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iPhone");
    expect(deviceOf("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128 Electron/32.0 Safari/537.36")).toBe("приложение для ПК · Windows");
    expect(deviceOf("")).toBe("");
  });
  it("в тексте — устройство, время и просьба не нажимать наугад", () => {
    const text = loginPromptText("Chrome · Windows", new Date("2026-10-30T09:05:00Z"));
    expect(text).toContain("Chrome · Windows");
    expect(text).toContain("12:05");
    expect(text).toMatch(/не выбирайте число наугад/);
    expect(text).toMatch(/по чьей-то просьбе/);
  });
});
