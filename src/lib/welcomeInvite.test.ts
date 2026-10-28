import { describe, expect, it } from "vitest";
import { welcomeLink, welcomeMessage } from "./welcomeInvite";

describe("приглашение «всё в одном»", () => {
  it("ссылка ведёт на страницу приглашения на нашем домене", () => {
    expect(welcomeLink("https://t.example/", "ABCD2345")).toBe("https://t.example/welcome/ABCD2345");
  });

  it("сообщение обращается по имени и несёт ссылку", () => {
    const text = welcomeMessage("Иван Петров", "https://t.example/welcome/X");
    expect(text.startsWith("Иван, привет!")).toBe(true);
    expect(text).toContain("https://t.example/welcome/X");
  });

  it("без имени — просто «Привет»", () => {
    expect(welcomeMessage("  ", "L").startsWith("Привет!")).toBe(true);
  });
});
