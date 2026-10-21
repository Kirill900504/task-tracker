import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";
import { pickAnyExecutor } from "./helpers";

// Длинное название в шапке задачи раскрывается ПЛАВНО, а номер и кнопки
// рядом стоят на месте. 21.10.2026 Кирилл прислал два снимка: название из
// тысячи знаков вываливалось на полэкрана за один кадр, а номер «#135»
// уезжал к середине развёрнутого текста. Меряется то, что видно: высота
// названия посреди перехода (между свёрнутой и развёрнутой — значит,
// переход есть) и место номера до, во время и после.

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
}

// Нажатие и три замера в одном задании браузера: между вызовами Playwright
// переход успел бы кончиться.
async function clickAndSample(page: Page) {
  return page.evaluate(async () => {
    const title = document.querySelector<HTMLElement>(".modal .item-head.one-line .item-head-title")!;
    const kicker = document.querySelector<HTMLElement>(".modal .item-head.one-line .item-head-kicker")!;
    const top = () => kicker.getBoundingClientRect().top;
    const h = () => title.getBoundingClientRect().height;
    // Окно само въезжает на 8px (modal-in) — замер «до» ждёт, пока встанет.
    await new Promise((r) => setTimeout(r, 400));
    const before = { h: h(), kicker: top() };
    title.click();
    await new Promise((r) => setTimeout(r, 120));
    const mid = { h: h(), kicker: top() };
    await new Promise((r) => setTimeout(r, 600));
    const after = { h: h(), kicker: top(), open: title.classList.contains("open") };
    return { before, mid, after, cap: window.innerHeight * 0.34 };
  });
}

test("длинное название в шапке раскрывается плавно, номер стоит на месте", async ({ page }) => {
  const stamp = Date.now();
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", "Очень длинное название задачи ".repeat(40) + stamp);
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: String(stamp) });
  await expect(card).toHaveCount(1);
  await card.locator(".task-title").click();
  await expect(page.locator(".modal .item-head.one-line .item-head-title")).toBeVisible();

  const open = await clickAndSample(page);
  expect(open.after.open).toBe(true);
  expect(open.after.h).toBeGreaterThan(open.before.h + 20);
  // Посреди — ни свёрнутая, ни развёрнутая: это и есть «плавно».
  expect(open.mid.h).toBeGreaterThan(open.before.h + 1);
  expect(open.mid.h).toBeLessThan(open.after.h - 1);
  // Номер не двигается ни на пиксель.
  expect(Math.abs(open.mid.kicker - open.before.kicker)).toBeLessThan(1);
  expect(Math.abs(open.after.kicker - open.before.kicker)).toBeLessThan(1);
  // И развёрнутое не закрывает собой всю задачу.
  expect(open.after.h).toBeLessThanOrEqual(Math.min(open.cap, 300) + 1);

  const close = await clickAndSample(page);
  expect(close.after.open).toBe(false);
  expect(close.mid.h).toBeLessThan(close.before.h - 1);
  expect(close.mid.h).toBeGreaterThan(close.after.h + 1);
  expect(Math.abs(close.after.h - open.before.h)).toBeLessThan(1);
  expect(Math.abs(close.after.kicker - open.before.kicker)).toBeLessThan(1);
});

// Влезшее название не нажимается вовсе (21.10.2026: «когда название влазит
// в стандартную рамку, оно было не кликабельно… двигаются разделы, на
// миллиметры»). Развёрнутая рамка на долю пикселя выше свёрнутой, и
// нажатие по короткому названию сдвигало описание и обсуждение под шапкой.
test("короткое название в шапке не раскрывается и ничего не двигает", async ({ page }) => {
  const stamp = Date.now();
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", "Коротко " + stamp);
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: String(stamp) });
  await expect(card).toHaveCount(1);
  await card.locator(".task-title").click();
  const title = page.locator(".modal .item-head.one-line .item-head-title");
  await expect(title).toHaveAttribute("data-overflow", "0");
  expect(await title.evaluate((el) => getComputedStyle(el).cursor)).toBe("default");

  const r = await clickAndSample(page);
  expect(r.after.open).toBe(false);
  expect(Math.abs(r.after.h - r.before.h)).toBeLessThan(0.5);
});
