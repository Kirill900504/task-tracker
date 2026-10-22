import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { pickSelfExecutor, pickWatcher } from "./helpers";
import { userFilePath } from "./userFile";

// Без связи ответы копятся и уходят сами (lib/outbox).
//
// 21.10.2026, его слова: «надо чтоб трекер работал и накапливал изменения
// и данные в режиме без интернета! а при появлении сети снова обновлял и
// подсасывал данные». Задачи без сети сохранялись и раньше (офлайн-тест в
// tracker.spec.ts), а «Сделал» и реплика в чате — нет: первое
// откатывалось словами «Ответ НЕ ушёл», второе возвращалось в поле.
//
// Отрезается именно то, что режет настоящая сеть Макарова: наш сайт
// (/api) и запись реплик, — а база для чтения остаётся. Это самый
// коварный случай: перечитывание приносит «ещё не ответил» и стёрло бы
// ответ с экрана, если бы очередь не накладывалась поверх.
//
// И проверяется БАЗОЙ, а не экраном: «ушло» — обещание (CLAUDE.md).

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
  const { data } = await admin.from("tasks").select("id, status").eq("user_id", userId).eq("title", title).maybeSingle();
  return data as { id: string; status: string } | null;
}

async function cutServer(page: Page) {
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await page.route("**/rest/v1/item_comments**", (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
  );
}

test("без связи «Сделал» и реплика ждут в очереди, переживают перезагрузку и уходят сами", async ({ page }) => {
  test.setTimeout(180_000);
  const title = `E2E очередь ${Date.now()}`;
  const note = `Без связи ${Date.now()}`;
  await login(page);

  // Наблюдатель — чтобы задача не была «своей»: у своей нет «Сделал».
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await pickWatcher(page);
  await page.click("#saveTaskBtn");
  await expect.poll(async () => (await taskRow(title))?.id || "", { timeout: 30_000 }).not.toBe("");
  const taskId = (await taskRow(title))!.id;

  const card = page.locator(".task", { hasText: title }).first();
  await card.locator(".task-title").click();
  const modal = page.locator("dialog[open]#overlay");
  await expect(modal.locator(".my-work")).toBeVisible({ timeout: 20_000 });

  await cutServer(page);

  // Реплика: остаётся в ленте с пометкой, а не возвращается в поле.
  const box = modal.locator(".chat-composer textarea");
  await box.fill(note);
  await box.press("Enter");
  await expect(modal.locator(".chat-msg", { hasText: note })).toContainText("ждёт сети", { timeout: 20_000 });
  await expect(box).toHaveValue("");

  // «Сделал»: окно закрывается как обычно — ни слова об ошибке.
  await modal.locator(".my-work .btn", { hasText: "Сделал" }).click();
  await page.fill("#myWorkDone", "Готово без связи");
  await modal.locator(".ms-answer-actions .btn", { hasText: "Готово" }).click();
  await expect(page.locator("dialog[open]#overlay")).toHaveCount(0, { timeout: 20_000 });

  // В базе — ничего: ответы правда не ушли. А значок говорит, сколько ждут.
  await expect(page.locator("#connOfflineBtn .conn-status-badge")).toBeVisible({ timeout: 20_000 });
  expect((await taskRow(title))?.status).not.toBe("done");
  const { data: none } = await admin.from("item_comments").select("id").eq("item_id", taskId).eq("body", note);
  expect(none || []).toHaveLength(0);

  // Перезагрузка без связи с сервером: очередь лежит в браузере, не в вкладке.
  await page.reload();
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#connOfflineBtn .conn-status-badge")).toBeVisible({ timeout: 20_000 });

  // Связь вернулась — всё уходит само, без единого нажатия.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await taskRow(title))?.status, { timeout: 90_000 }).toBe("done");
  await expect
    .poll(async () => ((await admin.from("item_comments").select("id").eq("item_id", taskId).eq("body", note)).data || []).length, {
      timeout: 30_000,
    })
    .toBe(1);
  await expect(page.locator("#connOfflineBtn")).toHaveCount(0, { timeout: 60_000 });

  await admin.from("tasks").delete().eq("id", taskId);
});
