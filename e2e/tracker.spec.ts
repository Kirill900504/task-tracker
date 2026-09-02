import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The one smoke test covering the actual "Definition of Done" checklist
// (login, create task, complete task, create meeting, create idea,
// calendar, logout) — see e2e/global-setup.ts for why running this against
// the live deployment is safe (an isolated, disposable test account, not
// Кирилл's real one). Run with:
//   npx playwright test --config=playwright.config.ts
// (needs NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the
// environment — e.g. `node --env-file=.env.local` isn't usable here since
// Playwright is its own process; use `npx dotenv-run` or export them first.)

const { email, password } = JSON.parse(readFileSync(join(__dirname, ".e2e-user.json"), "utf8"));

test("full loop: login, task, meeting, idea, calendar, logout", async ({ page }) => {
  const stamp = Date.now();
  const taskTitle = `E2E задача ${stamp}`;
  const meetingTitle = `E2E встреча ${stamp}`;
  const ideaText = `E2E идея ${stamp}`;

  // ---- Login ----
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();

  // Keep completed items visible for the rest of the run, so the "complete
  // a task" assertion below doesn't need to know where done tasks move to.
  await page.check("#showDoneCheckbox");

  // ---- Create task ----
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", taskTitle);
  await page.click("#saveTaskBtn");
  const taskCard = page.locator(".task", { hasText: taskTitle });
  await expect(taskCard).toBeVisible();

  // ---- Complete task ----
  await taskCard.locator(".check").click();
  await expect(taskCard).toHaveClass(/done/);

  // ---- Create meeting ----
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", meetingTitle);
  await page.click("#meetingSaveBtn");
  await expect(page.locator(".meeting-chip", { hasText: meetingTitle })).toBeVisible();

  // ---- Create idea ----
  await page.fill("#ideaInput", ideaText);
  await page.click("#ideaAddBtn");
  await expect(page.locator(".idea-item", { hasText: ideaText })).toBeVisible();

  // ---- Calendar renders ----
  await expect(page.locator(".cal-day").first()).toBeVisible();
  await expect(page.locator("#calMonthLabel")).not.toBeEmpty();

  // ---- Logout ----
  await page.click("#signOutBtn");
  await expect(page).toHaveURL(/\/login/);
});
