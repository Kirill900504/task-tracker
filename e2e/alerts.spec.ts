import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";
import { pickSelfExecutor } from "./helpers";

// Всплывающие уведомления (07.10.2026, hooks/useDesktopAlerts).
//
// Окно Windows Playwright увидеть не может — у headless-браузера нет
// разрешения на него, и это ровно та ветка, где уведомление падает в своё
// окошко в углу трекера. Окошко проверяется так же, как его увидел бы
// человек: событие случилось в базе (служебным ключом, как его пишет любой
// маршрут), а трекер сам узнал о нём и сказал. Источник событий для обоих
// путей один, так что сломайся опрос или подписка — молчали бы оба.

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

test("событие в обсуждении всплывает, открывает задачу и глушится колокольчиком", async ({ page }) => {
  test.setTimeout(150_000);
  const title = `E2E уведомление ${Date.now()}`;

  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });

  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(`.task:has-text("${title}")`).first();
  await expect(card).toBeVisible({ timeout: 20_000 });

  let taskId = "";
  await expect
    .poll(async () => {
      const { data } = await admin.from("tasks").select("id").eq("title", title).maybeSingle();
      taskId = (data as { id: string } | null)?.id || "";
      return taskId;
    }, { timeout: 20_000 })
    .not.toBe("");

  // Строка хроники от чужого имени — так её пишет маршрут, когда
  // исполнитель отвечает из мессенджера: без автора-пользователя.
  // Событие — из тех, что адресованы постановщику (lib/desktopAlerts,
  // addresseeOf): «принял в работу» с 13.10.2026 молчит нарочно — по нему
  // некому действовать, — а «отчитался» ждёт решения автора.
  await admin.from("item_comments").insert({ item_kind: "task", item_id: taskId, body: "🏁 Робот отчитался: готово", source: "app", system: true });

  // Подписка приносит это за секунду, опрос — не позже чем через минуту.
  const toast = page.locator(".toast-open", { hasText: "Робот отчитался" });
  await expect(toast).toBeVisible({ timeout: 75_000 });
  await expect(toast).toContainText(title);
  await expect(page.locator(".toast-actions button", { hasText: "Не показывать ход работы" })).toBeVisible();

  // Нажатие на уведомление открывает ту самую задачу.
  await toast.click();
  await expect(page.locator("#taskFacts")).toBeVisible();

  // «Не беспокоить» по обсуждению — в шапке обсуждения, и оно запоминается.
  const mute = page.locator(`[data-chat="task:${taskId}"] .chat-mute`);
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // Колокольчик — это меню, а не неактивная картинка: тишина на час.
  await page.click("#notifPermBtn");
  await page.locator(".export-item", { hasText: "Тишина на час" }).click();
  await expect(page.locator("#notifPermBtn")).toHaveAttribute("aria-label", /тишина до/);
  await page.click("#notifPermBtn");
  await page.locator(".export-item", { hasText: "Снять тишину" }).click();
  await expect(page.locator("#notifPermBtn")).toHaveAttribute("aria-label", "Уведомления");
});

// Общий выключатель и плашка «Включите уведомления» (15.10.2026, по
// образцу корпоративного мессенджера). Выключено в колокольчике — плашка
// под шапкой говорит об этом вслух, «Включить» там же возвращает всё.
test("уведомления выключаются целиком и включаются плашкой под шапкой", async ({ page }) => {
  // Окна Windows разрешены — иначе плашка после «Включить» просит
  // разрешения у браузера и остаётся, а этот тест про выключатель.
  await page.context().grantPermissions(["notifications"]);
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });

  await page.click("#notifPermBtn");
  await page.locator(".export-item", { hasText: "Выключить все уведомления" }).click();
  await expect(page.locator("#notifPermBtn")).toHaveAttribute("aria-label", "Уведомления выключены");
  const banner = page.locator("#notifyBanner");
  await expect(banner).toContainText("Уведомления выключены");

  // Остальные рычаги при выключенном всём ни на что не влияют — их нет.
  await page.click("#notifPermBtn");
  await expect(page.locator(".export-item", { hasText: "Тишина на час" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Выключатель живёт между открытиями трекера.
  await page.reload();
  await expect(page.locator("#notifyBanner")).toBeVisible({ timeout: 30_000 });

  await page.click("#notifyBannerOn");
  await expect(page.locator("#notifyBanner")).toHaveCount(0);
  await expect(page.locator("#notifPermBtn")).toHaveAttribute("aria-label", "Уведомления");
});
