import { test, expect, type Page } from "@playwright/test";
import { CARD_CORNER } from "./helpers";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { userFilePath } from "./userFile";

// То, что одобрено 14.10.2026, одним сценарием: срок обязателен (даже у
// задачи самому себе), чек-лист в задаче с «1/2» на кубике, «#номер» в
// обсуждении открывает ту задачу, и перенос срока считается (миграция 0058).
// Сохранение проверяется запросом к базе, а не экраном.

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

// Себя исполнителем — без помощника, который ставит срок сам: здесь срок
// и проверяется.
async function meAsExecutor(page: Page) {
  const chip = page.locator('#fPeople .participant-chip[data-self="true"]').first();
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await chip.click();
  await page.locator(".export-menu, .action-sheet").first().locator(".export-item").filter({ hasText: /^Исполнитель/ }).click();
  await expect(chip).toHaveClass(/role-executor/);
}

async function row(title: string) {
  const { data } = await admin.from("tasks").select("id, number, deadline, deadline_moves").eq("user_id", userId).eq("title", title).maybeSingle();
  return data as { id: string; number: number; deadline: string; deadline_moves: number } | null;
}

test("срок обязателен, чек-лист, #номер и счёт переносов", async ({ page }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const first = `E2E срок ${stamp}`;
  const second = `E2E ссылка ${stamp}`;
  await login(page);

  // Без срока форма не сохраняет — и говорит почему.
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", first);
  await meAsExecutor(page);
  await expect(page.locator(".field-req", { hasText: "Нужен срок" })).toBeVisible();
  await page.click("#saveTaskBtn");
  await expect(page.locator(".ask-modal")).toContainText("Нужен срок");
  await page.click("#askOkBtn");
  await page.locator(".deadline-row .participant-chip", { hasText: "Завтра" }).first().click();
  await page.click("#saveTaskBtn");
  await expect.poll(async () => (await row(first))?.deadline || "", { timeout: 30_000 }).not.toBe("");
  const firstRow = (await row(first))!;

  // Перенос срока считается: у своей задачи срок двигается в карточке.
  const card = page.locator(".task", { hasText: first }).first();
  await card.click(CARD_CORNER);
  await page.locator("#selfDeadline .participant-chip", { hasText: "Через неделю" }).click();
  await expect.poll(async () => (await row(first))?.deadline_moves ?? 0, { timeout: 30_000 }).toBe(1);

  // Чек-лист: два шага, один отмечен; в базе так и есть, на кубике «1/2».
  await page.fill("#checklistAdd", "Первый шаг");
  await page.press("#checklistAdd", "Enter");
  await page.fill("#checklistAdd", "Второй шаг");
  await page.press("#checklistAdd", "Enter");
  await page.locator("#taskChecklist .checklist-item", { hasText: "Первый шаг" }).locator(".check").click();
  await expect
    .poll(async () => {
      const { data } = await admin.from("task_checklist").select("done").eq("task_id", firstRow.id);
      return (data || []).map((r) => (r.done ? 1 : 0) as number).sort().join("");
    }, { timeout: 30_000 })
    .toBe("01");
  // Быстрые нажатия подряд (21.10.2026: «нажал, а галка сама отжалась
  // обратно»): эхо первой записи будило перечитывание, которое приносило
  // базу без ещё летящей второй. Четыре нажатия без пауз возвращают то же
  // состояние — и экран, и база обязаны его удержать, а не моргнуть.
  const checkOf = (text: string) => page.locator("#taskChecklist .checklist-item", { hasText: text }).locator(".check");
  await checkOf("Второй шаг").click();
  await checkOf("Второй шаг").click();
  await checkOf("Первый шаг").click();
  await checkOf("Первый шаг").click();
  await page.waitForTimeout(3000);
  await expect(checkOf("Первый шаг")).toHaveAttribute("aria-pressed", "true");
  await expect(checkOf("Второй шаг")).toHaveAttribute("aria-pressed", "false");
  const { data: afterBurst } = await admin.from("task_checklist").select("text, done").eq("task_id", firstRow.id);
  expect(Object.fromEntries((afterBurst || []).map((r) => [r.text, r.done]))).toEqual({ "Первый шаг": true, "Второй шаг": false });
  await page.keyboard.press("Escape");
  await expect(card.locator(".task-checklist")).toHaveText("1/2", { timeout: 30_000 });
  // Число переносов — рядом со сроком.
  await expect(card.locator(".task-moves")).toContainText("1", { timeout: 30_000 });

  // «#номер» в обсуждении другой задачи открывает первую.
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", second);
  await meAsExecutor(page);
  await page.locator(".deadline-row .participant-chip", { hasText: "Завтра" }).first().click();
  // Вторая ждёт первую (миграция 0061) — на кубике «Ждёт #N».
  await page.click("#fWaitsFor");
  await page.locator(".dd-option", { hasText: `#${firstRow.number} ` }).click();
  await page.click("#saveTaskBtn");
  const secondCard = page.locator(".task", { hasText: second }).first();
  await expect(secondCard.locator(".task-waits")).toHaveText(`Ждёт #${firstRow.number}`, { timeout: 30_000 });
  await expect.poll(async () => {
    const { data } = await admin.from("tasks").select("blocked_by").eq("user_id", userId).eq("title", second).maybeSingle();
    return (data as { blocked_by: string | null } | null)?.blocked_by || "";
  }, { timeout: 30_000 }).toBe(firstRow.id);
  await secondCard.click(CARD_CORNER);
  const box = page.locator("dialog[open] .chat-composer textarea");
  await box.fill(`см. #${firstRow.number}`);
  await box.press("Enter");
  const link = page.locator("dialog[open] .chat-task-link", { hasText: `#${firstRow.number}` });
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.click();
  await expect(page.locator("#modalTitle")).toHaveText(first, { timeout: 20_000 });
});
