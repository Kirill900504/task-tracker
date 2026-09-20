import { describe, it, expect } from "vitest";
import { hasMessengerLaunch, miniAppRedirect } from "./messengerLaunch";

// Перехват существует ради одного случая: ссылка мини-приложения ведёт на
// корень трекера, человек без сессии уезжает на /login и видит форму с
// паролем, которого не помнит, — при том что мессенджер только что
// подтвердил, кто он. Проверяем, что перехват срабатывает на обоих
// мессенджерах и НЕ срабатывает на обычном заходе.

describe("приход из мини-приложения", () => {
  it("узнаёт Telegram", () => {
    expect(hasMessengerLaunch("#tgWebAppData=user%3D%257B%2522id%2522%253A1%257D&tgWebAppVersion=7.0")).toBe(true);
  });

  it("узнаёт MAX", () => {
    expect(hasMessengerLaunch("#WebAppData=user%3D%257B%2522id%2522%253A1%257D&WebAppPlatform=web")).toBe(true);
  });

  it("не трогает обычный заход на страницу входа", () => {
    // Иначе человек, набравший адрес руками, уезжал бы на страницу,
    // которая ему ничего не скажет.
    expect(hasMessengerLaunch("")).toBe(false);
    expect(hasMessengerLaunch("#")).toBe(false);
    expect(hasMessengerLaunch("#section=team")).toBe(false);
  });

  it("уносит фрагмент с собой целиком", () => {
    // В нём и лежит подпись. Потерять его по дороге — это тот же тупик,
    // только с лишним переходом.
    const hash = "#WebAppData=user%3D%257B%2522id%2522%253A7879486%257D&WebAppPlatform=web";
    expect(miniAppRedirect(hash)).toBe("/app" + hash);
  });

  it("добавляет решётку, если её не было", () => {
    expect(miniAppRedirect("tgWebAppData=x")).toBe("/app#tgWebAppData=x");
  });
});
