import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { pickSelfExecutor } from "./helpers";
import { userFilePath } from "./userFile";

// Картинка во вложении: миниатюра, которая ДЕЙСТВИТЕЛЬНО загрузилась, и окно
// просмотра поверх карточки.
//
// 07.10.2026 Кирилл прислал снимок отчёта, где вместо фотографии стоял
// значок битой картинки. Файл в хранилище был целым — браузер отказывался
// его грузить: политика безопасности (CSP) разрешала картинки только со
// своего домена, а подписанная ссылка ведёт на хост Supabase. Ни один тест
// этого не видел, потому что проверяли наличие <img>, а не то, что в нём
// что-то нарисовано. Отсюда главная проверка здесь — naturalWidth > 0.
//
// Отдельным файлом по той же причине, что reopen.spec.ts: Playwright не
// даёт спекам импортировать друг друга, а вход живёт локально.

const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
  const btn = page.locator("#showDoneCheckbox");
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
}

async function waitForPeople(): Promise<void> {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  for (let i = 0; i < 40; i++) {
    const { data } = await admin.from("assignees").select("id").eq("user_id", userId).limit(1);
    if ((data || []).length) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Список людей у тестового аккаунта так и не появился за 20 секунд");
}

test("фото в отчёте — миниатюра, по нажатию окно, Esc закрывает только его", async ({ page }) => {
  const title = `E2E вложение ${Date.now()}`;
  await login(page);
  await waitForPeople();

  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await expect(page.locator("#syncStatus")).toHaveText("✓ Сохранено", { timeout: 10_000 });

  await card.click();
  const report = page.locator(".my-work .btn", { hasText: "Сделал" });
  await expect(report).toBeVisible({ timeout: 20_000 });
  await report.click();
  await page.fill("#myWorkDone", "Фото установки");
  await page.locator(".ms-answer-files input[type=file]").setInputFiles({
    name: "foto.png",
    mimeType: "image/png",
    buffer: readFileSync("public/favicon.png"),
  });
  await page.locator(".ms-answer-actions .btn", { hasText: "Отправить отчёт" }).click();
  await expect(page.locator("#overlay")).toHaveCount(0, { timeout: 15_000 });

  const done = page.locator("#col-done .task", { hasText: title });
  await expect(done).toBeVisible({ timeout: 15_000 });
  await done.click();

  const thumb = page.locator(".result-files .file-item.image img");
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  // Нарисована, а не просто стоит в разметке: битая картинка тоже <img>.
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);

  await thumb.click();
  const viewer = page.locator("dialog.viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.locator(".viewer-image")).toBeVisible();
  await expect(viewer.locator(".viewer-name")).toContainText("foto.png");

  // Escape закрывает окно просмотра, а карточка задачи под ним остаётся.
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page.locator(".result-files .file-item.image img")).toBeVisible();
});
