import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ensureDeadline, pickSelfExecutor, CARD_CORNER } from "./helpers";
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
  await card.first().click(CARD_CORNER);

  // Строки участия доезжают отдельно — ждём, пока карточка поймёт, что
  // задача своя, и покажет срок.
  await expect(page.locator("#selfDeadline")).toBeVisible({ timeout: 20_000 });
  const modal = page.locator("dialog[open]");
  await expect(modal.getByRole("button", { name: /Принял/ })).toHaveCount(0);
  await expect(modal.getByRole("button", { name: /Не могу/ })).toHaveCount(0);
  await expect(modal.locator("#forceCloseBtn")).toHaveCount(0);

  // «Завтра» двигает срок сразу, без просьбы и решения.
  await page.locator("#selfDeadline .participant-chip", { hasText: "Завтра" }).click();
  await expect(page.locator("#selfDeadline .participant-chip", { hasText: "Завтра" })).toHaveClass(/selected/);
});

// Новая своя задача — личная с первого кадра (27.10.2026: «сперва
// появляется как будто я постановщик другому человеку, а потом через 2 сек
// переделывается в личную»). Состав выводится из строк участия, а они
// пишутся только после того, как задача доехала до базы, — поэтому обе
// записи здесь задержаны на пять секунд, и метка обязана стоять раньше.
test("новая своя задача сразу показана личной", async ({ page }) => {
  const title = `E2E сразу личная ${Date.now()}`;
  await login(page);
  await page.route(/\/rest\/v1\/(tasks|task_participants)(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") await new Promise((r) => setTimeout(r, 5000));
    await route.continue();
  });
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");

  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Личная задача", { timeout: 1500 });
  await expect(card.locator(".task-people")).toHaveCount(0);
});

// Та же гарантия у задач из повестки встречи: они назначались мимо
// заготовок (assignExecutorsByName) и первые секунды стояли без людей.
test("задача из повестки на себя сразу показана личной", async ({ page }) => {
  const stamp = Date.now();
  const item = `E2E пункт ${stamp}`;
  await login(page);
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", `E2E повестка ${stamp}`);
  await page.fill("#mAgenda", item);
  await page.click("#agendaAddBtn");
  // Повестку пишет saveAgendaDraft, когда встреча уже в базе; «Успех»
  // раньше этого читает пустую повестку и предлагает задачу по итогу.
  const agendaSaved = page.waitForResponse(
    (r) => /\/rest\/v1\/meeting_agenda/.test(r.url()) && r.request().method() === "POST" && r.ok(),
    { timeout: 30_000 },
  );
  await page.click("#meetingSaveBtn");
  await agendaSaved;
  const chip = page.locator(".meeting-chip", { hasText: `E2E повестка ${stamp}` });
  await expect(chip).toBeVisible();

  await chip.locator(".meeting-act.success").click();
  await page.fill("#askInput", "Решили");
  await page.click("#askOkBtn");
  await expect(page.locator("#recapTasksSheet")).toBeVisible({ timeout: 20_000 });

  await page.route(/\/rest\/v1\/(tasks|task_participants)(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") await new Promise((r) => setTimeout(r, 5000));
    await route.continue();
  });
  await page.click("#recapTasksCreate");

  const card = page.locator(".task", { hasText: item });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Личная задача", { timeout: 1500 });
});

// Наблюдатель рядом задачу «своей» не отменяет (23.10.2026: мысль,
// переведённая в задачу на себя с наблюдателем, шла полной дорогой —
// «Принял / Сделал», «Принудительное закрытие»). Работаю по ней только я.
test("своя задача с наблюдателем — всё равно своя", async ({ page }) => {
  const title = `E2E своя+наблюдатель ${Date.now()}`;
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  const other = page.locator('#fPeople .participant-chip:not(.chip-add):not([data-self="true"])').first();
  await expect(other).toBeVisible({ timeout: 20_000 });
  await other.click();
  await page.locator(".export-menu, .action-sheet").first().locator(".export-item").filter({ hasText: /^Наблюдатель/ }).click();
  await expect(other).toHaveClass(/role-watcher/);
  await page.click("#saveTaskBtn");

  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Личная задача", { timeout: 20_000 });
  await card.first().click(CARD_CORNER);
  await expect(page.locator("#selfDeadline")).toBeVisible({ timeout: 20_000 });
  const modal = page.locator("dialog[open]");
  await expect(modal.getByRole("button", { name: /Принял/ })).toHaveCount(0);
  await expect(modal.locator("#forceCloseBtn")).toHaveCount(0);
  await expect(modal.locator("#taskPeople .tpeople-watcher .tperson")).toHaveCount(1);
});

// «Личная» у поля людей (23.10.2026): одно нажатие — я исполнитель, и
// кнопка нажата, пока задача и правда личная. Второй исполнитель её
// отжимает, повторное «Личная» возвращает задачу мне одному.
test("кнопка «Личная» ставит меня единственным исполнителем", async ({ page }) => {
  const title = `E2E кнопка личная ${Date.now()}`;
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  const btn = page.locator("#personalTaskBtn");
  const me = page.locator('#fPeople .participant-chip[data-self="true"]').first();
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await btn.click();
  await expect(me).toHaveClass(/role-executor/);
  await expect(btn).toHaveAttribute("aria-pressed", "true");

  const other = page.locator('#fPeople .participant-chip:not(.chip-add):not([data-self="true"])').first();
  await other.click();
  await page.locator(".export-menu, .action-sheet").first().locator(".export-item").filter({ hasText: /^Исполнитель/ }).click();
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await btn.click();
  await expect(other).not.toHaveClass(/selected/);
  await expect(btn).toHaveAttribute("aria-pressed", "true");

  await ensureDeadline(page);
  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: title })).toContainText("Личная задача", { timeout: 20_000 });
});

// Строка «Срок» и окно «Отложить до…» — одной строкой (22.10.2026: «поле
// строк в одну строку все кнопки умеси!!!»). Меряет браузер: все кнопки
// ряда на одной линии и ряд не шире своего места — и на ПК, и на телефоне.
// Сравниваются СЕРЕДИНЫ кнопок, а не верхние края: кнопки разной высоты
// выровнены по центру, и их верх законно расходится на пару пикселей.
async function oneLine(row: import("@playwright/test").Locator) {
  return row.evaluate((el) => {
    const mids = [...el.children]
      .flatMap((c) => (getComputedStyle(c).display === "contents" ? [...c.children] : [c]))
      .filter((c) => !c.classList.contains("cal-sheet-scrim") && c.getBoundingClientRect().height > 0)
      .map((c) => {
        const r = c.getBoundingClientRect();
        return r.top + r.height / 2;
      });
    return { rows: mids.every((m) => Math.abs(m - mids[0]) < 4) ? 1 : 2, fits: el.scrollWidth <= el.clientWidth + 1 };
  });
}

for (const size of [
  { name: "ПК", width: 1280, height: 860 },
  { name: "телефон", width: 390, height: 844 },
]) {
  test(`строка срока и «Отложить до…» — в одну строку (${size.name})`, async ({ page }) => {
    const title = `E2E строка ${size.name} ${Date.now()}`;
    await page.setViewportSize({ width: size.width, height: size.height });
    // Свой вход, а не login(): оболочка телефона поднимается дольше пяти
    // секунд, которые login() даёт кнопке «+».
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await expect(page.locator("#newTaskBtn:visible")).toBeVisible({ timeout: 20_000 });
    await page.click("#newTaskBtn:visible");
    await page.fill("#fTitle", title);
    await pickSelfExecutor(page);
    await page.click("#saveTaskBtn");
    const card = page.locator(".task", { hasText: title });
    await expect(card).toBeVisible();
    await card.first().click(CARD_CORNER);
    const row = page.locator("#selfDeadline .deadline-row");
    await expect(row).toBeVisible({ timeout: 20_000 });
    expect(await oneLine(row)).toEqual({ rows: 1, fits: true });

    await page.click("#snoozeTaskBtn");
    const ask = page.locator(".ask-modal .ask-calendar");
    await expect(ask).toBeVisible();
    expect(await oneLine(ask)).toEqual({ rows: 1, fits: true });
  });
}
