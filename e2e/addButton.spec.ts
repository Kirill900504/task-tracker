import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";

// «+» слева от микрофона у каждого поля, из которого что-то заводится, и в
// фирменной заливке (21.10.2026, его слова: «слева от микрофона такую же
// фирменную кнопку „+“… с полной адаптацией под мобильную версию»).
// Проверяется то, что видит человек: где кнопка стоит относительно
// микрофона, чем залита (вычисленный цвет, а не класс) и что нажатие делает
// то же, что Enter. Отдельным файлом — вход живёт локально, спеки друг друга
// не импортируют.

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
}

// «+» в той же строке, что поле, слева от микрофона (если микрофон в этом
// браузере есть вообще), и залит фирменным цветом, а не серым.
async function expectBrandPlusBeforeMic(row: Locator) {
  const plus = row.locator(".field-add-btn");
  await expect(plus).toBeVisible();
  const mic = row.locator(".field-mic-btn:not(.field-add-btn)");
  if (await mic.count()) {
    const p = (await plus.boundingBox())!;
    const m = (await mic.boundingBox())!;
    expect(p.x + p.width).toBeLessThanOrEqual(m.x + 1);
    expect(Math.abs(p.y - m.y)).toBeLessThan(2);
  }
  const bg = await plus.evaluate((el) => getComputedStyle(el).backgroundColor);
  const accent = await plus.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    el.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(bg).toBe(accent);
  const box = (await plus.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(36);
  expect(box.height).toBeGreaterThanOrEqual(36);
}

async function checkForms(page: Page, openIdeas: () => Promise<void>, openMeetings: () => Promise<void>, openTasks: () => Promise<void>) {
  // Мысли: «+» фирменный и добавляет набранное.
  await openIdeas();
  const ideaRow = page.locator(".idea-add");
  await expectBrandPlusBeforeMic(ideaRow);
  await expect(ideaRow.locator(".field-add-btn")).toBeDisabled();
  const thought = `Мысль плюсом ${Date.now()}`;
  await page.fill("#ideaInput", thought);
  await ideaRow.locator(".field-add-btn").click();
  await expect(page.locator(".idea-item", { hasText: thought })).toBeVisible();
  await expect(page.locator("#ideaInput")).toHaveValue("");
  await page.locator(".idea-add").screenshot({ path: test.info().outputPath("ideas.png") });

  // Новая задача: «+» у названия и у описания.
  await openTasks();
  await page.click("#newTaskBtn");
  await expectBrandPlusBeforeMic(page.locator(".field", { has: page.locator("#fTitle") }).locator(".input-with-mic"));
  await expect(page.locator("#titleAddBtn")).toBeDisabled();
  await page.click("#addDescBtn");
  await expectBrandPlusBeforeMic(page.locator(".field", { has: page.locator("#fDesc") }).locator(".input-with-mic"));
  // На телефоне × спрятан за стрелкой «назад» — Escape закрывает везде.
  await page.keyboard.press("Escape");
  await expect(page.locator("#fTitle")).toHaveCount(0);

  // Новая встреча: «+» у названия и у повестки; в повестке он добавляет пункт.
  await openMeetings();
  await page.click("#addMeetingBtn");
  await expectBrandPlusBeforeMic(page.locator(".field", { has: page.locator("#mTitle") }).locator(".input-with-mic"));
  const agenda = page.locator("#agendaDraft .input-with-mic");
  await expectBrandPlusBeforeMic(agenda);
  await page.fill("#mAgenda", "Смета");
  await page.click("#agendaAddBtn");
  await expect(page.locator(".agenda-draft-item", { hasText: "Смета" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("meeting.png") });
  await expect(page.locator("#mAgenda")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#mTitle")).toHaveCount(0);
}

test("«+» слева от микрофона — на компьютере", async ({ page }) => {
  await login(page);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
  await checkForms(
    page,
    async () => {},
    async () => {},
    async () => {},
  );
});

test.describe("на телефоне", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("«+» слева от микрофона — на телефоне, и строка не вылезает за экран", async ({ page }) => {
    await login(page);
    await checkForms(
      page,
      async () => {
        await page.click('[data-tab="ideas"]');
        const row = (await page.locator(".idea-add").boundingBox())!;
        expect(row.x + row.width).toBeLessThanOrEqual(390);
      },
      async () => {
        await page.click('[data-tab="meetings"]');
      },
      async () => {
        await page.click('[data-tab="tasks"]');
      },
    );
  });
});
