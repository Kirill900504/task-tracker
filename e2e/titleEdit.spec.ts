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

async function titleOf(id: string) {
  const { data } = await admin.from("tasks").select("title").eq("user_id", userId).eq("id", id).maybeSingle();
  return (data as { title: string } | null)?.title || "";
}

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
  await modal.locator("#renameTaskBtn").click();
  const headInput = modal.locator("#taskTitleEdit");
  await expect(headInput).toBeFocused();
  // Escape в поле закрывает правку, а не окно.
  await headInput.press("Escape");
  await expect(modal).toBeVisible();
  await expect(modal.locator("#taskTitleEdit")).toHaveCount(0);

  await modal.locator("#renameTaskBtn").click();
  await headInput.press("End");
  await headInput.pressSequentially(" окно");
  await headInput.press("Enter");
  await expect(modal.locator(".item-head-title")).toHaveText(`${title} доска окно`);
  await expect.poll(() => titleOf(id), { timeout: 30_000 }).toBe(`${title} доска окно`);
  await modal.locator("#cancelBtn").click();
  await expect(card.locator(".task-title")).toHaveText(`${title} доска окно`);
});
