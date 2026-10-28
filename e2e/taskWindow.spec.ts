import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { pickSelfExecutor, pickCoexecutor, CARD_CORNER } from "./helpers";
import { userFilePath } from "./userFile";

// Окно заведённой задачи и кубик на доске — вид 13.10.2026.
//
// Слова Кирилла, по которым это сделано: описание — «отдельным визуально
// приятным блоком… с возможностью редактировать и дополнять, в том числе
// файлами»; «Кто на задаче» дублирует сводку — «его предлагаю вообще
// убрать, а в верхнем блоке добавить небольшую кнопочку „+“»; кнопки
// «Удалить / Сохранить / Отмена» — убрать, «в правом верхнем углу должен
// быть крестик»; «Закрыть волевым решением» → «Принудительное закрытие» в
// правом верхнем углу, с обязательным комментарием, только у постановщика.
//
// Сохранение здесь проверяется ЗАПРОСОМ К БАЗЕ, а не экраном: «Сохранено» —
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

async function taskRow(title: string) {
  const { data } = await admin
    .from("tasks")
    .select("id, description, desc_files, approval_state, status")
    .eq("user_id", userId)
    .eq("title", title)
    .maybeSingle();
  return data as { id: string; description: string; desc_files: { name: string }[]; approval_state: string; status: string } | null;
}

test("окно задачи: описание с файлом, люди в сводке, автосохранение, принудительное закрытие", async ({ page }) => {
  test.setTimeout(150_000);
  const title = `E2E окно ${Date.now()}`;
  await login(page);

  // Новая задача: описание и файл к нему — прямо в форме.
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await page.click("#addDescBtn");
  await page.fill("#fDesc", "Что сделать: собрать конспект.");
  await page.locator("#fDesc").locator("xpath=ancestor::div[contains(@class,'field')]").locator('input[type="file"]').setInputFiles({
    name: "tz.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("техзадание"),
  });
  await expect(page.locator(".ms-answer-file", { hasText: "tz.txt" })).toBeVisible();
  await pickSelfExecutor(page);
  // Соисполнитель — чтобы задача была не «своей»: у своей нет принудительного
  // закрытия (её закрывают галочкой).
  await pickCoexecutor(page);
  await page.click("#saveTaskBtn");

  // Файл и описание доехали до базы вместе с задачей.
  await expect.poll(async () => (await taskRow(title))?.desc_files?.map((f) => f.name).join(",") || "", { timeout: 30_000 }).toBe("tz.txt");

  // Кубик: номер, название, люди; никакого «0/1».
  const card = page.locator(".task", { hasText: title }).first();
  await expect(card).toBeVisible();
  await expect(card.locator(".task-top .task-title")).toHaveText(title);
  await expect(card.locator(".task-people")).toBeVisible();
  await expect(card.locator(".task-progress-short")).toHaveCount(0);

  await card.click(CARD_CORNER);
  const modal = page.locator("dialog[open]#overlay");
  await expect(modal.locator("#taskFacts")).toBeVisible();
  // Название — в рамке шапки, крестик справа, снизу кнопок нет.
  await expect(modal.locator(".item-head-title")).toHaveText(title);
  await expect(modal.locator("#cancelBtn")).toBeVisible();
  await expect(modal.locator("#saveTaskBtn")).toHaveCount(0);
  await expect(modal.locator(".modal-actions")).toHaveCount(0);
  // Старого блока «Кто на задаче» нет — люди в сводке, по ролям.
  await expect(modal).not.toContainText("Кто на задаче");
  await expect(modal.locator("#taskFacts #taskPeople")).toBeVisible();
  await expect(modal.locator("#taskPeople .tpeople-executor .tperson")).toHaveCount(1, { timeout: 20_000 });
  await expect(modal.locator("#taskPeople .tpeople-coexecutor .tperson")).toHaveCount(1);
  // Описание — своим блоком, с файлом.
  await expect(modal.locator("#taskDesc")).toContainText("собрать конспект");
  await expect(modal.locator("#taskDesc")).toContainText("tz.txt");

  // Единственного исполнителя убрать нельзя — трекер говорит почему.
  await modal.locator("#taskPeople .tpeople-executor .tperson").click();
  await page.locator(".action-menu .export-item", { hasText: "Убрать с задачи" }).click();
  await expect(page.locator(".ask-modal")).toContainText("единственный исполнитель");
  await page.click("#askOkBtn");

  // Описание правится и пишется само — даже если окно закрыли посреди правки.
  await modal.locator("#editDescBtn").click();
  await page.locator("#taskDescEdit").press("End");
  await page.locator("#taskDescEdit").type(" Дополнено.");
  await modal.locator("#cancelBtn").click();
  await expect(page.locator("dialog[open]#overlay")).toHaveCount(0);
  await expect.poll(async () => (await taskRow(title))?.description || "", { timeout: 30_000 }).toContain("Дополнено.");

  // Принудительное закрытие: без комментария нельзя, с ним — закрыта.
  await card.click(CARD_CORNER);
  await expect(modal.locator("#forceCloseBtn")).toContainText("Принудительное закрытие");
  await modal.locator("#forceCloseBtn").click();
  await page.click("#askOkBtn");
  await expect(page.locator(".ask-modal .ask-problem")).toBeVisible();
  await page.fill("#askInput", "Закрываю: сделали без трекера.");
  await page.click("#askOkBtn");
  await expect.poll(async () => (await taskRow(title))?.approval_state || "", { timeout: 30_000 }).toBe("accepted");

  // Поле сообщения не растягивается рукой.
  const row = await taskRow(title);
  if (row) await admin.from("tasks").delete().eq("id", row.id);
});

test("поле сообщения: без ручки и не выше пяти строк", async ({ page }) => {
  const title = `E2E чат ${Date.now()}`;
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  await page.locator(".task", { hasText: title }).first().click(CARD_CORNER);
  const box = page.locator("dialog[open] .chat-composer textarea");
  await expect(box).toBeVisible();
  expect(await box.evaluate((el) => getComputedStyle(el).resize)).toBe("none");
  await box.fill(Array.from({ length: 20 }, (_, i) => `строка ${i}`).join("\n"));
  const lineHeight = await box.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  const height = await box.evaluate((el) => el.getBoundingClientRect().height);
  expect(height, "поле выросло выше пяти строк").toBeLessThanOrEqual(lineHeight * 5 + 30);
  await page.keyboard.press("Escape");
  const row = await taskRow(title);
  if (row) await admin.from("tasks").delete().eq("id", row.id);
});
