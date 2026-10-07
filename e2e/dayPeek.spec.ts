import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dayCell, pickAnyExecutor } from "./helpers";
import { userFilePath } from "./userFile";

// Правая кнопка на дне календаря — «что на этот день» (DayPeek). Задача и
// встреча заводятся с того же дня левым щелчком, то есть ровно тем путём,
// которым их заводит человек, и обязаны появиться в окне; строка окна
// открывает свою карточку. День — завтрашний: встречу в прошлом не завести,
// а вечером у сегодняшнего дня может не остаться ни одного слота.

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

test("правый щелчок по дню показывает его задачи и встречи", async ({ page }) => {
  const stamp = Date.now();
  const taskTitle = `E2E день-задача ${stamp}`;
  const meetingTitle = `E2E день-встреча ${stamp}`;

  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getMonth() !== new Date().getMonth()) await page.click("#calNextBtn");
  const cell = dayCell(page, tomorrow.getDate());

  // Задача на этот день.
  await cell.click();
  await page.click("#datePopoverTaskBtn");
  await page.fill("#fTitle", taskTitle);
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: taskTitle })).toBeVisible();

  // Встреча на этот день — первое свободное время.
  await cell.click();
  await page.click("#datePopoverMeetingBtn");
  await page.fill("#mTitle", meetingTitle);
  await page.locator("#mTimeGrid .time-slot:enabled").first().click();
  await page.click("#meetingSaveBtn");
  await expect(page.locator(".meeting-chip", { hasText: meetingTitle })).toBeVisible();

  // Правая кнопка — окно со всем, что на этот день.
  await cell.click({ button: "right" });
  const peek = page.locator("#dayPeek");
  await expect(peek).toBeVisible();
  await expect(peek.locator(".day-peek-row", { hasText: taskTitle })).toBeVisible();
  await expect(peek.locator(".day-peek-row", { hasText: meetingTitle })).toBeVisible();
  // Окно целиком на экране. Календарь стоит внизу правой колонки, и окно,
  // замеренное до открытия слоя (высота 0), не переворачивалось вверх и
  // уезжало за нижний край — toBeVisible этого не видит, видна лишь рамка.
  const box = await peek.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.y >= 0 && box.y + box.height <= viewport.height).toBeTruthy();
  // Левый поповер при этом не открылся — правая кнопка показывает, а не заводит.
  await expect(page.locator("#datePopover")).toHaveCount(0);

  // Escape закрывает окно.
  await page.keyboard.press("Escape");
  await expect(peek).toHaveCount(0);

  // Строка задачи открывает её карточку.
  await cell.click({ button: "right" });
  await peek.locator(".day-peek-row", { hasText: taskTitle }).click();
  await expect(peek).toHaveCount(0);
  await expect(page.locator("dialog[open]", { hasText: taskTitle })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]", { hasText: taskTitle })).toHaveCount(0);

  // Строка встречи открывает её карточку.
  await cell.click({ button: "right" });
  await peek.locator(".day-peek-row", { hasText: meetingTitle }).click();
  await expect(page.locator("dialog[open]", { hasText: meetingTitle })).toBeVisible();
});
