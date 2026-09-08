import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The phone layout is a different tree, not a narrower one — its own header,
// its own navigation, its own first screen — so it needs its own tests. The
// disposable account and the base URL are the same ones the desktop suite
// uses (see e2e/global-setup.ts).
const { email, password } = JSON.parse(readFileSync(join(__dirname, ".e2e-user.json"), "utf8"));

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#mobileNav")).toBeVisible({ timeout: 20_000 });
}

test("the phone gets its own shell: compact header, tabs, and a Today screen", async ({ page }) => {
  await login(page);

  // The desktop header — logo, quote and eight buttons — is not there.
  await expect(page.locator("#mobileHeader")).toBeVisible();
  await expect(page.locator(".header-quote")).toHaveCount(0);
  await expect(page.locator("#todayScreen")).toBeVisible();

  // Everything else lives behind «…», so the header stays one row.
  await page.click("#mobileMoreBtn");
  await expect(page.locator("#mobileMoreMenu")).toBeVisible();
  await expect(page.locator(".export-item", { hasText: "Команда" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#mobileMoreMenu")).toHaveCount(0);

  // Nothing may stick out sideways: a horizontal scrollbar on a phone is the
  // classic sign of a desktop layout squeezed into it.
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});

test("tabs switch sections and a task can be created from the phone", async ({ page }) => {
  const title = `E2E моб ${Date.now()}`;

  await login(page);

  await page.click('[data-tab="tasks"]');
  // The filters are folded away — the list is what you came for.
  await expect(page.locator("#newTaskBtn")).toBeVisible();
  await expect(page.locator("#filterAssignee")).toBeHidden();
  await page.click("#mobileFiltersBtn");
  await expect(page.locator("#filterAssignee")).toBeVisible();
  await page.click("#mobileFiltersBtn");

  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  // The form fills the screen, and its buttons stay reachable at the bottom.
  const modalBox = await page.locator(".modal").boundingBox();
  expect(modalBox?.width).toBeGreaterThan(380);
  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: title })).toBeVisible();

  // And the Today screen accounts for it: a task with no date is not today's
  // business, but it is never silently dropped — it shows as a count, either
  // beside the empty state or under the day's list.
  await page.click('[data-tab="today"]');
  await expect(page.locator("#todayScreen")).toBeVisible();
  await expect(page.locator("#todayScreen")).toContainText("Без срока");
});

test("a task is finished by swiping the card to the right", async ({ page }) => {
  const title = `E2E свайп ${Date.now()}`;

  await login(page);
  await page.click('[data-tab="tasks"]');
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();

  // Playwright has no touch-drag, so the pointer sequence is dispatched
  // directly — the handlers under test are the ones a real finger reaches.
  await page.evaluate((taskTitle) => {
    const el = [...document.querySelectorAll(".task")].find((t) => t.textContent?.includes(taskTitle));
    if (!el) throw new Error("card not found");
    const rect = el.getBoundingClientRect();
    const base = { pointerType: "touch", bubbles: true, isPrimary: true, pointerId: 1 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...base, clientX: rect.left + 40, clientY: rect.top + 20 }));
    el.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: rect.left + 90, clientY: rect.top + 22 }));
    el.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: rect.left + 200, clientY: rect.top + 24 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: rect.left + 200, clientY: rect.top + 24 }));
  }, title);

  // A finished task leaves the open list — that IS the visible result of the
  // gesture. It is still there under «показать завершённые», now marked done.
  await expect(card).toHaveCount(0);
  await page.click("#mobileMoreBtn");
  await page.click(".export-item:has-text('Показать завершённые')");
  await expect(page.locator(".task", { hasText: title })).toHaveClass(/done/);
});
