import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";

// Окно быстрого переноса встречи (кнопка «Перенос» в списке, 20.10.2026):
// справа от даты — «Сегодня / Завтра / Через неделю», как в форме встречи,
// а время — прежнее или, если в новый день оно занято у кого-то из
// состава, следующее свободное после него. Арифметику подбора проверяет
// src/lib/meetingTime.test.ts (rescheduleTime); здесь — что окно ею
// пользуется и кнопки стоят в одной строке с датой.

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

test("перенос встречи: кнопки дней рядом с датой, занятое время сдвигается дальше", async ({ page }) => {
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
  const overlay = page.locator("#confirmDateTimeOverlay");
  await expect(overlay).toBeVisible();

  // Три кнопки — в одной строке с датой, справа от неё.
  const quick = overlay.locator("#confirmDateTimeQuick .participant-chip");
  await expect(quick).toHaveText(["Сегодня", "Завтра", "Через неделю"]);
  const dateBox = await overlay.locator("#confirmDateTimeQuick button").first().boundingBox();
  const weekBox = await quick.last().boundingBox();
  expect(dateBox && weekBox && Math.abs(dateBox.y - weekBox.y) < 8 && weekBox.x > dateBox.x).toBe(true);

  // «Через неделю»: 11:00 там занято — выбрано следующее свободное после него.
  await quick.last().click();
  await expect(quick.last()).toHaveClass(/selected/);
  const selected = overlay.locator("#confirmDateTimeTime .time-slot.selected");
  await expect(selected).toHaveCount(1);
  await expect(selected).not.toHaveText("11:00");
  await expect(selected).not.toHaveClass(/busy/);
  expect(((await selected.textContent()) || "") > "11:00").toBe(true);
  await expect(page.locator("#confirmDateTimeOkBtn")).toBeEnabled();

  // А обратно на «Завтра» — снова прежние 11:00: подбор помнит время встречи.
  await quick.nth(1).click();
  await expect(selected).toHaveText("11:00");

  await page.click("#confirmDateTimeCancelBtn");
  await expect(overlay).toHaveCount(0);
});
