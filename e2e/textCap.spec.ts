import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";

// Текстовое поле растёт по тексту до 14 строк, а дальше прокручивается
// внутри. 14.10.2026 Кирилл прислал снимок формы новой задачи, где длинное
// название растянуло окно за край экрана: у названия потолка не было вовсе,
// у описания он был только потому, что его передавал вызов. Теперь потолок
// один (TEXT_MAX_ROWS в AutoGrowTextarea, --text-max-rows в
// text-fields.css), и сторожит его этот файл — по высоте, которую считает
// браузер, а не по классу: класс на поле стоял и тогда.
//
// Отдельным файлом по той же причине, что reopen.spec.ts: Playwright не
// даёт спекам импортировать друг друга, а вход живёт локально.

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
}

// Высота поля, сколько строк в него влезает и есть ли прокрутка внутри.
async function measure(page: Page, selector: string) {
  return page.locator(selector).evaluate((el: HTMLTextAreaElement) => {
    const s = getComputedStyle(el);
    const line = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.5;
    const chrome =
      parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) + parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
    return {
      rows: (el.offsetHeight - chrome) / line,
      scrolls: el.scrollHeight > el.clientHeight + 1 && s.overflowY === "auto",
    };
  });
}

test("название новой задачи растёт до 14 строк, дальше бегунок", async ({ page }) => {
  await login(page);
  await page.click("#newTaskBtn");

  // Короткое название — одна строка, без прокрутки.
  await page.fill("#fTitle", "Короткое");
  const short = await measure(page, "#fTitle");
  expect(Math.round(short.rows)).toBe(1);
  expect(short.scrolls).toBe(false);

  // Длинное — ровно потолок, остальное внутри.
  const long = "Большая большая мобильная тестовая задача трааааааааааааааааааааа ".repeat(40);
  await page.fill("#fTitle", long);
  const tall = await measure(page, "#fTitle");
  expect(Math.round(tall.rows)).toBe(14);
  expect(tall.scrolls).toBe(true);

  // Кнопка сохранения при этом остаётся на экране.
  await expect(page.locator("#saveTaskBtn")).toBeInViewport();
});
