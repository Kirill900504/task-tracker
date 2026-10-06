import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";
import { pickSelfExecutor } from "./helpers";

// Сторожа к тому, что нашёл полный QA-проход 06.10.2026 руками в браузере.
//
// Каждая из этих поломок жила при зелёном наборе: стрелку «Назад» никто не
// искал на компьютере (класс у неё был правильный — перебивало чужое
// правило), встречу по умолчанию никто не открывал вечером, поиск по «КП»
// никто не набирал, а «(я)» проверяли в одном месте из четырёх. Поэтому
// здесь спрашивается то, что видит человек, а не то, что лежит в разметке.

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 20_000 });
}

test("на компьютере у окна нет мобильной стрелки «Назад»", async ({ page }) => {
  await login(page);
  await page.click("#newTaskBtn");
  await expect(page.locator("#fTitle")).toBeVisible();
  // Стрелка существует в разметке каждого окна и обязана быть невидимой на
  // ПК: `button:has(> .icon)` перебивал её `display:none` специфичностью.
  await expect(page.locator("dialog[open] .modal-back-btn")).toBeHidden();
  await page.keyboard.press("Escape");
});

test("после «Название не заполнено» фокус возвращается в название", async ({ page }) => {
  await login(page);
  await page.click("#newTaskBtn");
  await page.locator("dialog[open] .modal").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.click("#saveTaskBtn");
  await page.getByRole("button", { name: "Понятно" }).click();
  await expect(page.locator("#fTitle")).toBeFocused();
  await expect(page.locator("#fTitle")).toBeInViewport();
});

test("новая встреча по умолчанию не стоит в прошлом", async ({ page }) => {
  await login(page);
  await page.keyboard.press("b");
  await expect(page.locator("#mTitle")).toBeVisible();
  const date = await page.locator("#mDate").getAttribute("data-value");
  const time = (await page.locator("#mTimeGrid .time-slot.selected").textContent())?.trim();
  expect(date, "дата встречи выбрана").toBeTruthy();
  expect(time, "время встречи выбрано").toMatch(/^\d{2}:\d{2}$/);
  const startsAt = new Date(`${date}T${time}:00`).getTime();
  // В браузере теста то же время, что и у страницы, — сравнивать можно.
  expect(startsAt).toBeGreaterThan(Date.now());
  await page.keyboard.press("Escape");
});

test("поиск находит двухбуквенное слово вроде «КП»", async ({ page }) => {
  const mark = `${Date.now()}`;
  await login(page);
  await page.fill("#ideaInput", `Отправить КП клиенту ${mark}`);
  await page.press("#ideaInput", "Enter");
  await expect(page.locator(".idea-item", { hasText: mark }).first()).toBeVisible();
  await page.click("#searchBtn");
  await page.keyboard.type("КП");
  await expect(page.locator("#searchOverlay", { hasText: mark })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("пометки «(я)» нет на экране задачи", async ({ page }) => {
  const title = `QA без я ${Date.now()}`;
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  await page.locator(".task", { hasText: title }).locator(".task-title").click();
  const card = page.locator("dialog[open]");
  await expect(card.locator("#taskFacts")).toBeVisible();
  await expect(card).not.toContainText("(я)");
  await page.keyboard.press("Escape");
});
