import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";

// Кнопка «Перенос» на карточке встречи в списке (23.10.2026) открывает ту
// же полную форму переноса, что и кнопка в окне встречи: можно поменять и
// дополнить состав, а не только дату и время. Время — прежнее или, если в
// новый день оно занято у кого-то из состава, следующее свободное после
// него. Арифметику подбора проверяет src/lib/meetingTime.test.ts
// (rescheduleTime); здесь — что форма ею пользуется.

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

async function newMeeting(page: Page, title: string, day: string, time: string, person: string) {
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  await page.locator("#meetingOverlay .deadline-row .participant-chip", { hasText: day }).click();
  await page.locator("#mTimeGrid .time-slot", { hasText: time }).click();
  await page.locator("#mParticipants .participant-chip", { hasText: person }).click();
  await page.click("#meetingSaveBtn");
  await expect(page.locator(".meeting-chip", { hasText: title })).toBeVisible();
  await waitForSaved(page);
}

test("перенос из списка: полная форма с составом, занятое время сдвигается дальше", async ({ page }) => {
  const stamp = Date.now();
  await login(page);
  await page.setViewportSize({ width: 1600, height: 1000 });

  // Тот же человек на обеих встречах — иначе занятость не считается.
  await page.click("#addMeetingBtn");
  const person = ((await page.locator("#mParticipants .participant-chip").first().textContent()) || "").trim();
  expect(person).not.toBe("");
  await page.keyboard.press("Escape");

  // «Через неделю» в 11:00 занято, переносимая стоит завтра в 11:00. Не
  // 16:00: его на тот же день и тому же человеку ставит meetingBusy.spec.
  await newMeeting(page, `E2E занято ${stamp}`, "Через неделю", "11:00", person);
  const moved = `E2E перенос ${stamp}`;
  await newMeeting(page, moved, "Завтра", "11:00", person);

  await page.locator(".meeting-chip", { hasText: moved }).getByRole("button", { name: "Перенос" }).click();
  await expect(page.locator("#meetingModalTitle")).toHaveText("Перенос встречи");
  await expect(page.locator("#mTitle")).toHaveValue(moved);
  // Состав прежний — и его можно менять: ради этого форма и открывается.
  await expect(page.locator("#mParticipants .participant-chip", { hasText: person })).toHaveClass(/selected/);

  // «Через неделю»: 11:00 там занято — выбрано следующее свободное после него.
  await page.locator("#meetingOverlay .deadline-row .participant-chip", { hasText: "Через неделю" }).click();
  const selected = page.locator("#mTimeGrid .time-slot.selected");
  await expect(selected).toHaveCount(1);
  await expect(selected).not.toHaveText("11:00");
  expect(((await selected.textContent()) || "") > "11:00").toBe(true);

  // А обратно на «Завтра» — снова прежние 11:00: подбор помнит время встречи.
  await page.locator("#meetingOverlay .deadline-row .participant-chip", { hasText: "Завтра" }).click();
  await expect(selected).toHaveText("11:00");

  // Открыта из списка — Escape закрывает форму целиком, без окна встречи.
  await page.keyboard.press("Escape");
  await expect(page.locator("#meetingOverlay")).toHaveCount(0);
  await expect(page.locator(".meeting-chip", { hasText: moved })).toHaveCount(1);
});
