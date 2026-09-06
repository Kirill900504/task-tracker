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

// The meeting form is where most of the UI work of the last weeks landed
// (one-tap time grid, participant chips, outcome + result in the same
// modal), and it is also where the modal-portal bug lived: .dash-panel has
// container-type:inline-size, which made it the containing block for the
// position:fixed overlay and left the Save button un-clickable. Playwright's
// actionability checks are what caught that, so driving this form end to end
// is the regression test for it.
test("meeting: time slot, participants, then closing it with an outcome", async ({ page }) => {
  const title = `E2E встреча-итог ${Date.now()}`;

  await login(page);
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  await page.locator("#mTimeGrid .time-slot", { hasText: "10:00" }).click();

  const firstChip = page.locator("#mParticipants .participant-chip").first();
  const participant = (await firstChip.textContent())?.trim() || "";
  expect(participant).not.toBe("");
  await firstChip.click();
  await expect(firstChip).toHaveClass(/selected/);

  await page.click("#meetingSaveBtn");
  const chip = page.locator(".meeting-chip", { hasText: title });
  await expect(chip).toBeVisible();
  await waitForSaved(page);

  // Reopen it: the slot and the participant come back as chosen, so the
  // grid's selection really is what got saved and not just local state.
  await chip.click();
  await expect(page.locator("#mTime")).toHaveValue("10:00");
  await expect(page.locator("#mParticipants .participant-chip", { hasText: participant })).toHaveClass(/selected/);

  await page.fill("#mResult", "Договорились по срокам");
  // «Успешно» writes the outcome and closes the modal on its own — there is
  // no second Save step for it.
  await page.click("#markSuccessBtn");
  await expect(page.locator("#meetingOverlay")).toHaveCount(0);
  await expect(chip).toHaveClass(/resolved/);
  await expect(chip.locator(".mstatus.success")).toBeVisible();
  await waitForSaved(page);

  // And it is still closed, with its outcome, after a reload. "Показывать
  // завершённые" is per-session, so it has to be turned back on first —
  // resolved meetings are hidden by default.
  await page.reload();
  await expect(page.locator("#newTaskBtn")).toBeVisible();
  await page.check("#showDoneCheckbox");
  await expect(page.locator(".meeting-chip", { hasText: title })).toHaveClass(/resolved/);
  await page.locator(".meeting-chip", { hasText: title }).click();
  await expect(page.locator("#mResult")).toHaveValue("Договорились по срокам");
});

// A recurring task's rule has to survive the round trip through the
// database — it is written across several columns (recur, recur_weekday…)
// that only the modal reads back.
test("a weekly recurring task keeps its rule across a reload", async ({ page }) => {
  const title = `E2E повтор ${Date.now()}`;

  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await page.selectOption("#fRecur", "weekly");
  await page.selectOption("#fRecurWeekday", "3");
  await page.selectOption("#fPriority", "high");
  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: title })).toBeVisible();
  await waitForSaved(page);

  await page.reload();
  await page.locator(".task", { hasText: title }).click();
  await expect(page.locator("#fRecur")).toHaveValue("weekly");
  await expect(page.locator("#fRecurWeekday")).toHaveValue("3");
  await expect(page.locator("#fPriority")).toHaveValue("high");
});

// "Сбросить расположение" kept reappearing on a fresh load even though
// nothing had been rearranged: the saved layout was compared with
// JSON.stringify, and Postgres reorders jsonb object keys, so the two were
// never equal. It is only meant to show when the panels really have been
// moved.
test("the layout reset button stays hidden when nothing was rearranged", async ({ page }) => {
  await login(page);
  await expect(page.locator("#resetLayoutBtn")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#newTaskBtn")).toBeVisible();
  await expect(page.locator("#resetLayoutBtn")).toHaveCount(0);
});

// Global search: "/" (or the button), type, click a hit — the item's own card
// opens. Covers the wiring between the overlay and each panel's modal, which
// is where a search that "finds but cannot open" would break.
test("search finds a task and opens its card", async ({ page }) => {
  const title = `E2E поиск ${Date.now()}`;

  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: title })).toBeVisible();
  await waitForSaved(page);

  // The keyboard route, not the button: "/" is the way this is meant to be used.
  await page.locator("body").click();
  await page.keyboard.press("/");
  await expect(page.locator("#searchInput")).toBeFocused();

  await page.fill("#searchInput", "поиск");
  const hit = page.locator(".search-hit", { hasText: title });
  await expect(hit).toBeVisible();
  await hit.click();

  await expect(page.locator("#searchOverlay")).toHaveCount(0);
  await expect(page.locator("#fTitle")).toHaveValue(title);

  // Esc closes the search without opening anything.
  await page.keyboard.press("Escape");
  await page.keyboard.press("/");
  await expect(page.locator("#searchInput")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#searchOverlay")).toHaveCount(0);
});

// The offline path end to end: work done without a connection has to survive
// a reload (it lives in IndexedDB, and the service worker serves the shell),
// and reach the database once the connection is back.
test("work done offline survives a reload and syncs when the network returns", async ({ page, context }) => {
  // Longer than the default: an offline start deliberately waits out the
  // network timeout before falling back to the local copy, and this test does
  // that twice.
  test.setTimeout(150_000);
  const onlineTitle = `E2E онлайн ${Date.now()}`;
  const offlineTitle = `E2E офлайн ${Date.now()}`;

  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", onlineTitle);
  await page.click("#saveTaskBtn");
  await waitForSaved(page);

  // The worker is deliberately not registered in development (it would serve
  // stale dev chunks), so against a dev server there is nothing to test here.
  const workerTakesControl = await page
    .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!workerTakesControl, "Service worker is off in development — run this against a production build");

  // And the shell has to actually be in its cache: until it is, an offline
  // reload has nothing to serve.
  await page.waitForFunction(
    async () => {
      const cache = await caches.open("rokas-shell-v2");
      return (await cache.match("/")) !== undefined;
    },
    null,
    { timeout: 20_000 },
  );

  await context.setOffline(true);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", offlineTitle);
  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: offlineTitle })).toBeVisible();
  // The save cannot land, and the tracker says so rather than pretending.
  await expect(page.locator("#syncStatus")).toContainText("Не сохранилось", { timeout: 20_000 });

  // Reload with no connection at all: the shell comes from the service
  // worker and the data from the offline copy — including the task that
  // never reached the database.
  await page.reload();
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#offlineBanner")).toBeVisible();
  await expect(page.locator(".task", { hasText: onlineTitle })).toBeVisible();
  await expect(page.locator(".task", { hasText: offlineTitle })).toBeVisible();

  // Back on the network: the offline work is pushed without being asked.
  await context.setOffline(false);
  await expect(page.locator("#offlineBanner")).toHaveCount(0, { timeout: 30_000 });
  await waitForSaved(page);

  await page.reload();
  await expect(page.locator(".task", { hasText: offlineTitle })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#offlineBanner")).toHaveCount(0);
});

// Taking the data out has to actually produce a file the browser saves —
// something only a real browser can prove.
test("export writes a CSV of the tasks", async ({ page }) => {
  const title = `E2E экспорт ${Date.now()}`;

  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: title })).toBeVisible();
  await waitForSaved(page);

  await page.click("#exportBtn");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".export-item", { hasText: "Задачи" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^rokas-задачи-\d{4}-\d{2}-\d{2}\.csv$/u);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain(title);
  expect(csv.split("\r\n")[0]).toContain("Задача;Описание");
});

// The four keys, driven as real key presses: a remap that silently stops
// working is invisible until you reach for it.
test("hotkeys open a task, a meeting and the idea field, Esc closes", async ({ page }) => {
  await login(page);
  await page.locator("body").click();

  await page.keyboard.press("n");
  await expect(page.locator("#fTitle")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#fTitle")).toHaveCount(0);

  await page.keyboard.press("b");
  await expect(page.locator("#mTitle")).toBeVisible();
  // Dated, so the form is ready to save rather than complaining about a date.
  await expect(page.locator("#mDate")).not.toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#mTitle")).toHaveCount(0);

  await page.keyboard.press("m");
  await expect(page.locator("#ideaInput")).toBeFocused();
});
