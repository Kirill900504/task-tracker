import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";

// Занятое время встречи заперто (07.10.2026). Кирилл назначил две встречи
// на 16:00 с одним и тем же человеком: форма предупреждала красным, но
// сохраняла. Теперь занятый слот нельзя нажать, час, заходящий на чужую
// встречу, нельзя выбрать, а время, ставшее занятым ПОСЛЕ выбора (человека
// позвали позже), не сохраняется. Арифметику пересечений проверяет
// src/lib/meetingTime.test.ts; здесь — что правило доехало до формы.

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
}

async function waitForSaved(page: Page) {
  await expect(page.locator("#syncStatus")).toHaveText("✓ Сохранено", { timeout: 10_000 });
  await expect(page.locator("#syncStatus")).not.toHaveClass(/show/, { timeout: 15_000 });
}

// Через неделю, а не завтра: остальные тесты встреч ставят «завтра» и
// первого человека из списка, и эта встреча не должна им мешать.
async function openNewMeeting(page: Page, title: string) {
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  await page.locator("#meetingOverlay .deadline-row .participant-chip", { hasText: "Через неделю" }).click();
}

const slot = (page: Page, time: string) => page.locator("#mTimeGrid .time-slot", { hasText: time });

test("занятое время встречи нельзя выбрать и нельзя сохранить", async ({ page }) => {
  const stamp = Date.now();
  await login(page);

  // Первая встреча: 16:00, первый человек из списка.
  await openNewMeeting(page, `E2E занято ${stamp}`);
  await slot(page, "16:00").click();
  const firstChip = page.locator("#mParticipants .participant-chip").first();
  const person = (await firstChip.textContent())?.trim() || "";
  expect(person).not.toBe("");
  await firstChip.click();
  await page.click("#meetingSaveBtn");
  await expect(page.locator(".meeting-chip", { hasText: `E2E занято ${stamp}` })).toBeVisible();
  await waitForSaved(page);

  // Вторая — с тем же человеком: 16:00 погашено и заметно занято.
  await openNewMeeting(page, `E2E поверх ${stamp}`);
  await page.locator("#mParticipants .participant-chip", { hasText: person }).click();
  await expect(slot(page, "16:00")).toHaveClass(/busy/);
  await expect(slot(page, "16:00")).toBeDisabled();
  // Соседние получасовки свободны…
  await expect(slot(page, "15:30")).toBeEnabled();
  await expect(slot(page, "16:30")).toBeEnabled();
  // …но час с 15:30 заходит на 16:00 — его не выбрать.
  await slot(page, "15:30").click();
  await expect(page.locator("#mDuration .participant-chip", { hasText: "1 час" })).toBeDisabled();

  // Время выбрано ДО человека: оно становится занятым, и сохранить нельзя.
  await page.locator("#mParticipants .participant-chip", { hasText: person }).click(); // убрать
  await slot(page, "16:00").click();
  await page.locator("#mParticipants .participant-chip", { hasText: person }).click(); // вернуть
  await expect(slot(page, "16:00")).toHaveClass(/selected/);
  await expect(slot(page, "16:00")).toHaveClass(/busy/);
  await expect(page.locator(".busy-now-hint")).toContainText("Так сохранить нельзя");  await page.click("#meetingSaveBtn");
  await expect(page.locator(".ask-question")).toContainText("уже на другой встрече");
  await page.click("#askOkBtn");
  // Форма осталась открытой, второй встречи нет.
  await expect(page.locator("#mTitle")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".meeting-chip", { hasText: `E2E поверх ${stamp}` })).toHaveCount(0);
});
