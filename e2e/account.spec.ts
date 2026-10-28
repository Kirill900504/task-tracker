import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";
import { pickAnyExecutor } from "./helpers";

// Личный кабинет и чат «как в мессенджере» — обе вещи появились 13.10.2026
// по просьбе Кирилла, и обе проверяются тем, что видит человек: окно
// открывается из своего имени в шапке, а смайлик встаёт в поле туда, где
// стоит курсор, а не в конец.

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
}

test("личный кабинет открывается из имени в шапке и показывает вход и мессенджеры", async ({ page }) => {
  await login(page);
  await page.click("#accountBtn");
  const modal = page.locator(".account-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("heading", { name: "Мои данные" })).toBeVisible();
  await expect(modal.getByRole("heading", { name: "Мессенджеры" })).toBeVisible();
  // Почта, с которой вошли, — в поле: её больше нигде в трекере не увидеть.
  await expect(modal.locator('input[type="email"]')).toHaveValue(email.toLowerCase());
  await modal.getByRole("button", { name: "Закрыть" }).click();
  await expect(modal).toBeHidden();
});

// «Мои данные» — второй шаг (28.10.2026): телефон сохраняется сам по себе,
// приходит к одному виду, а отметка на имени в шапке после этого гаснет.
test("в «Моих данных» сохраняется телефон, и отметка на имени гаснет", async ({ page }) => {
  await login(page);
  // У тестового аккаунта почта есть, телефона нет — данные не заполнены.
  await expect(page.locator("#profileDot")).toBeVisible({ timeout: 20_000 });
  await page.click("#accountBtn");
  const modal = page.locator(".account-modal");
  await page.fill("#accountPhone", "8 (900) 123 45 67");
  await page.click("#accountSaveBtn");
  await expect(modal.locator(".account-ok")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#accountPhone")).toHaveValue("+7 900 123-45-67");
  await expect(page.locator("#profileDot")).toHaveCount(0);
  // И это правда базы, а не экрана: после перезагрузки номер на месте.
  await modal.getByRole("button", { name: "Закрыть" }).click();
  await page.reload();
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
  await page.click("#accountBtn");
  await expect(page.locator("#accountPhone")).toHaveValue("+7 900 123-45-67", { timeout: 15_000 });
  await expect(page.locator("#profileDot")).toHaveCount(0);
});

test("смайлик из кнопки у поля встаёт на место курсора", async ({ page }) => {
  const title = `E2E смайлик ${Date.now()}`;
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  await expect(page.locator("#syncStatus")).toHaveText("✓ Сохранено", { timeout: 10_000 });

  await page.click(`.task:has-text("${title}")`);
  const composer = page.locator(".chat-composer textarea");
  await composer.fill("привет мир");
  await composer.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6));
  await page.click('.chat-composer button[aria-label="Смайлики"]');
  await expect(page.locator(".emoji-picker")).toBeVisible();
  await page.locator(".emoji-tab", { hasText: "👍" }).click();
  await page.locator(".emoji-cell", { hasText: "👍" }).first().click();
  await expect(composer).toHaveValue("привет👍 мир");

  // Одно открытие — один смайлик (14.10.2026): выбрал — окно закрылось, а
  // курсор вернулся в поле.
  await expect(page.locator(".emoji-picker")).toBeHidden();
  await expect(composer).toBeFocused();

  // Escape закрывает только его, а окно задачи остаётся.
  await page.click('.chat-composer button[aria-label="Смайлики"]');
  await expect(page.locator(".emoji-picker")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".emoji-picker")).toBeHidden();
  await expect(composer).toBeVisible();

  // Щелчок в любое другое место — в поле ввода — тоже закрывает.
  await page.click('.chat-composer button[aria-label="Смайлики"]');
  await expect(page.locator(".emoji-picker")).toBeVisible();
  await composer.click();
  await expect(page.locator(".emoji-picker")).toBeHidden();
  await expect(composer).toBeVisible();
});
