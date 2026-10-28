import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";
import { pickSelfExecutor, CARD_CORNER } from "./helpers";

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
    // Оба прямоугольника — в ОДНОМ кадре: окно появляется с анимацией, и
    // два отдельных замера попадали в разные её моменты.
    const [p, m] = await row.evaluate((el) =>
      [".field-add-btn", ".field-mic-btn:not(.field-add-btn)"].map((sel) => {
        const r = el.querySelector(sel)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width };
      }),
    );
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

  // Новая задача: у названия и описания «+» НЕТ — там он заводил задачу
  // целиком, повторяя «Создать», а читался как «сохранить это поле».
  await openTasks();
  await page.click("#newTaskBtn");
  const titleRow = page.locator(".field", { has: page.locator("#fTitle") }).locator(".input-with-mic");
  await expect(titleRow.locator(".field-mic-btn:not(.field-add-btn)")).toBeVisible();
  await expect(titleRow.locator(".field-add-btn")).toHaveCount(0);
  await page.click("#addDescBtn");
  const descRow = page.locator(".field", { has: page.locator("#fDesc") }).locator(".input-with-mic");
  await expect(descRow.locator(".field-mic-btn:not(.field-add-btn)")).toBeVisible();
  await expect(descRow.locator(".field-add-btn")).toHaveCount(0);
  // На телефоне × спрятан за стрелкой «назад» — Escape закрывает везде.
  await page.keyboard.press("Escape");
  await expect(page.locator("#fTitle")).toHaveCount(0);

  // Новая встреча: у названия «+» нет (по той же причине), у повестки есть —
  // там он добавляет пункт.
  await openMeetings();
  await page.click("#addMeetingBtn");
  await expect(page.locator(".field", { has: page.locator("#mTitle") }).locator(".field-add-btn")).toHaveCount(0);
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

// Поля ПРАВКИ — тоже с «+» (21.10.2026: «почему при заполнении итога встреч
// не добавил??? я же просил добавить везде»). Правка мысли, описание открытой
// задачи и итог встречи: «+» стоит, залит и записывает набранное.
test("«+» и в полях правки: мысль, описание задачи, итог встречи", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  await login(page);
  await expect(page.locator("#newTaskBtn")).toBeVisible();

  // Правка своей мысли.
  const thought = `Мысль для правки ${stamp}`;
  await page.fill("#ideaInput", thought);
  await page.press("#ideaInput", "Enter");
  const idea = page.locator(".idea-item", { hasText: thought });
  await idea.locator(".idea-text").click();
  const ideaRow = idea.locator(".input-with-mic");
  await expectBrandPlusBeforeMic(ideaRow);
  await ideaRow.locator("textarea").press("End");
  await ideaRow.locator("textarea").pressSequentially(" правка");
  await ideaRow.locator(".field-add-btn").click();
  await expect(page.locator(".idea-item", { hasText: `${thought} правка` }).locator(".idea-text")).toBeVisible();

  // Описание открытой задачи.
  const title = `E2E плюс описание ${stamp}`;
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await card.first().click(CARD_CORNER);
  const modal = page.locator("dialog[open]");
  await modal.locator("#editDescBtn").click();
  await expectBrandPlusBeforeMic(modal.locator("#taskDesc .input-with-mic"));
  await page.fill("#taskDescEdit", "Описание плюсом");
  await modal.locator("#descAddBtn").click();
  await expect(page.locator("#taskDescEdit")).toHaveCount(0);
  await expect(modal.locator("#taskDesc")).toContainText("Описание плюсом");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // Итог назначенной встречи.
  const mTitle = `E2E плюс итог ${stamp}`;
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", mTitle);
  await page.locator("#meetingOverlay .deadline-row .participant-chip", { hasText: "Завтра" }).click();
  await page.locator("#mParticipants .participant-chip").first().click();
  await page.locator("#mTimeGrid .time-slot:enabled:not(.selected)").first().click();
  await page.click("#meetingSaveBtn");
  const chip = page.locator(".meeting-chip", { hasText: mTitle });
  await expect(chip).toBeVisible();
  await chip.locator(".mtitle").click();
  const resultRow = page.locator(".input-with-mic", { has: page.locator("#mResult") });
  await expectBrandPlusBeforeMic(resultRow);
  await expect(page.locator("#resultAddBtn")).toBeDisabled();
  await page.fill("#mResult", "Решили плюсом");
  await page.click("#resultAddBtn");
  await page.keyboard.press("Escape");
  await expect(page.locator("#meetingOverlay")).toHaveCount(0);
  await chip.locator(".mtitle").click();
  await expect(page.locator("#mResult")).toHaveValue("Решили плюсом");
});
