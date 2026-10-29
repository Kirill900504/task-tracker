import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { pickSelfExecutor, CARD_CORNER } from "./helpers";
import { userFilePath } from "./userFile";

// Название задачи правится там, где его видно (28.10.2026, слова Кирилла:
// «добавить возможность удобно редактировать название задачи, в канбане
// нажав на поле, а в открытой задаче сделай удобный значок в поле названии
// задачи, понятный»).
//
// Сохранение проверяется ЗАПРОСОМ К БАЗЕ, а не экраном: «Сохранено» —
// обещание (CLAUDE.md, правило про тень).

const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
}

async function titleOf(id: string, table: "tasks" | "meetings" = "tasks") {
  const { data } = await admin.from(table).select("title").eq("user_id", userId).eq("id", id).maybeSingle();
  return (data as { title: string } | null)?.title || "";
}

// «Сделай аналогично и во встречах» (28.10.2026): то же самое у встречи —
// нажатием в списке и карандашом в её окне, а дата, время и состав
// по-прежнему меняются только переносом.
test("название встречи правится нажатием в списке и карандашом в окне", async ({ page }) => {
  test.setTimeout(120_000);
  const title = `E2E встреча ${Date.now()}`;
  await login(page);
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  await page.locator("#meetingOverlay .deadline-row .participant-chip", { hasText: "Через неделю" }).click();
  await page.locator("#mParticipants .participant-chip").first().click();
  await page.locator("#mTimeGrid .time-slot:enabled:not(.selected)").first().click();
  await page.click("#meetingSaveBtn");
  const found = page.locator(".meeting-chip", { hasText: title }).first();
  await expect(found).toBeVisible();
  const id = (await found.getAttribute("data-id"))!;
  const chip = page.locator(`.meeting-chip[data-id="${id}"]`);

  // Список: нажатие на название — поле на его месте, окно не открывается.
  await chip.locator(".mtitle").click();
  const input = chip.locator(".mtitle-input");
  await expect(input).toBeFocused();
  await expect(page.locator("#meetingOverlay")).toHaveCount(0);
  await input.press("End");
  await input.pressSequentially(" список");
  await input.press("Enter");
  await expect(chip.locator(".mtitle")).toHaveText(`${title} список`);
  await expect.poll(() => titleOf(id, "meetings"), { timeout: 30_000 }).toBe(`${title} список`);

  // Окно: карандаш в рамке названия; Escape закрывает правку, а не окно.
  await chip.click(CARD_CORNER);
  const modal = page.locator("dialog[open]#meetingOverlay");
  await expect(modal.locator(".item-head-title")).toHaveText(`${title} список`);
  await modal.locator("#renameTitleBtn").click();
  const headInput = modal.locator("#titleEdit");
  await expect(headInput).toBeFocused();
  await headInput.press("Escape");
  await expect(modal).toBeVisible();
  await modal.locator("#renameTitleBtn").click();
  await headInput.press("End");
  await headInput.pressSequentially(" окно");
  await headInput.press("Enter");
  await expect(modal.locator(".item-head-title")).toHaveText(`${title} список окно`);
  await expect.poll(() => titleOf(id, "meetings"), { timeout: 30_000 }).toBe(`${title} список окно`);
  await modal.locator("#meetingCancelBtn").click();
  await expect(chip.locator(".mtitle")).toHaveText(`${title} список окно`);
});

test("название правится нажатием на доске и карандашом в задаче", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const title = `E2E название ${stamp}`;
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");

  const found = page.locator(".task", { hasText: title }).first();
  await expect(found).toBeVisible();
  const id = (await found.getAttribute("data-id"))!;
  // Дальше — по id: пока название правится, текста кубика нет вовсе (оно в
  // поле), и поиск по тексту терял карточку посреди правки.
  const card = page.locator(`.task[data-id="${id}"]`);

  // Доска: нажатие на название — поле на его месте, окно НЕ открывается.
  await card.locator(".task-title").click();
  const input = card.locator(".task-title-input");
  await expect(input).toBeVisible();
  await expect(page.locator("dialog[open]#overlay")).toHaveCount(0);
  await expect(input).toBeFocused();
  // Пробел внутри поля — буква, а не «взять кубик клавиатурой».
  await input.press("End");
  await input.pressSequentially(" доска");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(card.locator(".task-title")).toHaveText(`${title} доска`);
  await expect.poll(() => titleOf(id), { timeout: 30_000 }).toBe(`${title} доска`);

  // Escape отменяет правку и ничего не пишет.
  await card.locator(".task-title").click();
  await card.locator(".task-title-input").fill("не то");
  await card.locator(".task-title-input").press("Escape");
  await expect(card.locator(".task-title")).toHaveText(`${title} доска`);

  // Окно задачи: карандаш в рамке названия.
  await card.click(CARD_CORNER);
  const modal = page.locator("dialog[open]#overlay");
  await expect(modal.locator(".item-head-title")).toHaveText(`${title} доска`);
  await modal.locator("#renameTitleBtn").click();
  const headInput = modal.locator("#titleEdit");
  await expect(headInput).toBeFocused();
  // Escape в поле закрывает правку, а не окно.
  await headInput.press("Escape");
  await expect(modal).toBeVisible();
  await expect(modal.locator("#titleEdit")).toHaveCount(0);

  await modal.locator("#renameTitleBtn").click();
  await headInput.press("End");
  await headInput.pressSequentially(" окно");
  await headInput.press("Enter");
  await expect(modal.locator(".item-head-title")).toHaveText(`${title} доска окно`);
  await expect.poll(() => titleOf(id), { timeout: 30_000 }).toBe(`${title} доска окно`);
  await modal.locator("#cancelBtn").click();
  await expect(card.locator(".task-title")).toHaveText(`${title} доска окно`);
});
