import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { pickSelfExecutor } from "./helpers";
import { userFilePath } from "./userFile";

// Задача самому себе — облегчённая модель (07.10.2026, lib/selfTask):
// в карточке нет «Принял / Сделал / Не могу / Прошу перенос», нет приёмки
// и волевого закрытия, а срок двигается прямо в ней.

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf-8")) as { email: string; password: string };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
}

test("своя задача: в карточке только срок, без ответов и приёмки", async ({ page }) => {
  const title = `E2E своя ${Date.now()}`;
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");

  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await card.locator(".task-title, .title").first().click();

  // Строки участия доезжают отдельно — ждём, пока карточка поймёт, что
  // задача своя, и покажет срок.
  await expect(page.locator("#selfDeadline")).toBeVisible({ timeout: 20_000 });
  const modal = page.locator("dialog[open]");
  await expect(modal.getByRole("button", { name: /Принял/ })).toHaveCount(0);
  await expect(modal.getByRole("button", { name: /Не могу/ })).toHaveCount(0);
  await expect(modal.getByRole("button", { name: /Закрыть волевым решением/ })).toHaveCount(0);

  // «Завтра» двигает срок сразу, без просьбы и решения.
  await page.locator("#selfDeadline .participant-chip", { hasText: "Завтра" }).click();
  await expect(page.locator("#selfDeadline .participant-chip", { hasText: "Завтра" })).toHaveClass(/selected/);
});
