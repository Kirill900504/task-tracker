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

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
  await page.check("#showDoneCheckbox");
}

// Two regression tests for "I closed things, signed out, signed back in, and
// they were back". Two distinct, independent bugs turned out to cause
// exactly that symptom:
//
// 1) softDeleteRow()/persistAll() fired their Supabase write independently
//    of the sign-out button, so clicking "Выйти" right after an edit could
//    navigate away — the browser aborts any still-in-flight request on
//    unload — before the write ever reached the database. Fixed by making
//    signOutBtn await the same syncChain persistAll()/softDeleteRow()/
//    restoreRow() already queue onto.
//
// 2) Far more serious: shadow.tasks/meetings/ideas was snapshotted as
//    `list.slice()` — a new ARRAY, but of the exact same object references
//    still live in `tasks`/`meetings`/`ideas`. Most edits (the done
//    checkbox, a meeting outcome button, the daily recurring-task reset)
//    mutate that shared object in place (`t.status = "done"`), which
//    silently mutates shadow's "last synced" copy too. The next
//    persistAll() diffs the object against shadow and finds no
//    difference — the edit is never sent to Supabase AT ALL, not even
//    eventually, regardless of sign-out timing. Fixed via snapshotList(),
//    which deep-clones each item when it enters shadow.
//
// Each test waits for its own setup write to fully settle (checked via
// #syncStatus) before performing the actual edit — otherwise a slow first
// write can still be in flight when the second action fires, which is a
// separate, unrelated timing quirk in how fast two back-to-back creates
// interact with the realtime echo, not the bug being tested here. Only the
// edit-then-sign-out step is immediate, since that immediacy is the point.
async function waitForSaved(page: import("@playwright/test").Page) {
  await expect(page.locator("#syncStatus")).toHaveText("✓ Сохранено", { timeout: 10_000 });
  // The text alone can still be left over from an earlier save while the one
  // just triggered is only about to start. The `show` class is dropped 2s
  // after a save actually finishes (SyncStatusPill), so waiting for it to go
  // away means nothing is in flight any more.
  await expect(page.locator("#syncStatus")).not.toHaveClass(/show/, { timeout: 15_000 });
}

test("completing a task survives an immediate sign-out", async ({ page }) => {
  const title = `E2E race done ${Date.now()}`;

  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await page.click("#saveTaskBtn");
  await waitForSaved(page);

  const taskCard = page.locator(".task", { hasText: title });
  await expect(taskCard).toBeVisible();

  // Mark done, then sign out immediately — no wait for that write to settle.
  await taskCard.locator(".check").click();
  await page.click("#signOutBtn");
  await expect(page).toHaveURL(/\/login/);

  await login(page);
  await expect(page.locator(".task", { hasText: title })).toHaveClass(/done/);
});

// Covers the whole drag-an-idea-onto-a-date flow end to end: the meeting
// modal opens pre-filled, the idea survives until the meeting is actually
// saved, and "Отменить" puts it back — which also means the delete has to
// have been soft, since restoring only flips deleted_at on a row that is
// still there. (It does NOT reproduce the stale-snapshot race in persistAll
// that this flow originally exposed — that one needed timing this test does
// not reliably hit; it was verified by hand instead.)
test("dragging an idea onto a calendar day converts it into a meeting", async ({ page }) => {
  const ideaText = `E2E идея-встреча ${Date.now()}`;

  await login(page);
  await page.fill("#ideaInput", ideaText);
  await page.click("#ideaAddBtn");
  await expect(page.locator(".idea-item", { hasText: ideaText })).toBeVisible();
  await waitForSaved(page);

  // Reload first, so the idea being dragged is one loaded from the database
  // rather than one this session just created — the everyday case.
  await page.reload();
  await expect(page.locator(".idea-item", { hasText: ideaText })).toBeVisible();

  // HTML5 drag-and-drop isn't driven reliably by real mouse events in
  // headless Chromium, so the drag is dispatched directly — the handlers
  // under test are the same ones a real drag reaches.
  await page.evaluate((text) => {
    const idea = [...document.querySelectorAll(".idea-item")].find((el) => el.textContent?.includes(text));
    const cell = [...document.querySelectorAll(".cal-day:not(.other-month)")].find(
      (el) => el.firstChild?.textContent?.trim() === "15",
    );
    if (!idea || !cell) throw new Error("idea or calendar cell not found");
    const dt = new DataTransfer();
    idea.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    cell.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    cell.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, ideaText);

  // The meeting modal opens pre-filled — the idea is still there until saved.
  await expect(page.locator("#meetingOverlay")).toBeVisible();
  await expect(page.locator("#mTitle")).toHaveValue(ideaText);
  await expect(page.locator(".idea-item", { hasText: ideaText })).toBeVisible();

  await page.click("#meetingSaveBtn");
  await expect(page.locator(".meeting-chip", { hasText: ideaText })).toBeVisible();
  await expect(page.locator(".idea-item", { hasText: ideaText })).toHaveCount(0);
  await waitForSaved(page);

  // "Отменить" is what proves the delete was soft: restoring flips
  // deleted_at back, which only works if the row is still there.
  await page.click(".toast-undo");
  await expect(page.locator(".idea-item", { hasText: ideaText })).toBeVisible();
  await expect(page.locator(".meeting-chip", { hasText: ideaText })).toHaveCount(0);
  await waitForSaved(page);

  await page.reload();
  await expect(page.locator(".idea-item", { hasText: ideaText })).toBeVisible();
  await expect(page.locator(".meeting-chip", { hasText: ideaText })).toHaveCount(0);
});

test("deleting a task survives an immediate sign-out", async ({ page }) => {
  const title = `E2E race deleted ${Date.now()}`;

  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await page.click("#saveTaskBtn");
  await waitForSaved(page);

  await expect(page.locator(".task", { hasText: title })).toBeVisible();

  // Open it, delete it, then sign out immediately.
  page.once("dialog", (d) => d.accept());
  await page.locator(".task", { hasText: title }).click();
  await page.click("#deleteTaskBtn");
  await page.click("#signOutBtn");
  await expect(page).toHaveURL(/\/login/);

  await login(page);
  await expect(page.locator(".task", { hasText: title })).toHaveCount(0);
});
