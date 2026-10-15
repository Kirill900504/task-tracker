import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";
import { pickAnyExecutor } from "./helpers";

// Два нажатия «Сохранить» — одна задача.
//
// В боевой базе нашлись близнецы «поискать БАЗЫ клиентов!» (21.09.2026):
// две строки с разными id через 41 мс — окно новой задачи отработало
// сохранение дважды, и каждый раз завело задачу с новым id. Защита
// `if (saving)` читала состояние из замыкания, а второе нажатие приходит
// раньше перерисовки и видит прежнее «не сохраняю».
//
// Воспроизводится это двумя кликами В ОДНОМ задании браузера: между ними
// React не успевает перерисоваться, окно и его обработчик ещё на месте —
// ровно та щель, в которую попадает дребезг кнопки или двойной тап.
// Проверяется по базе (перезагрузка), а не по экрану: близнец — это
// строка в базе, и экран мог бы склеить её с первой.

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
}

function clickTwice(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const button = document.querySelector<HTMLButtonElement>(sel);
    if (!button) throw new Error("нет кнопки " + sel);
    button.click();
    button.click();
  }, selector);
}

test("двойное «Сохранить» в новой задаче заводит одну задачу", async ({ page }) => {
  const title = `E2E двойное сохранение ${Date.now()}`;
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickAnyExecutor(page);
  await clickTwice(page, "#saveTaskBtn");
  await expect(page.locator("#syncStatus")).toHaveText("✓ Сохранено", { timeout: 10_000 });
  await expect(page.locator(".task", { hasText: title })).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".task", { hasText: title })).toHaveCount(1, { timeout: 10_000 });
});

test("двойное «Сохранить» в новой встрече заводит одну встречу", async ({ page }) => {
  const title = `E2E двойная встреча ${Date.now()}`;
  await login(page);
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  await clickTwice(page, "#meetingSaveBtn");
  await expect(page.locator("#syncStatus")).toHaveText("✓ Сохранено", { timeout: 10_000 });
  await expect(page.locator(".meeting-chip", { hasText: title })).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".meeting-chip", { hasText: title })).toHaveCount(1, { timeout: 10_000 });
});
