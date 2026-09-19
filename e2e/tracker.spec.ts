import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickAnyExecutor } from "./helpers";

// The one smoke test covering the actual "Definition of Done" checklist
// (login, create task, complete task, create meeting, create idea,
// calendar, logout) — see e2e/global-setup.ts for why running this against
// the live deployment is safe (an isolated, disposable test account, not
// Кирилл's real one). Run with:
//   npx playwright test --config=playwright.config.ts
// (needs NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the
// environment — e.g. `node --env-file=.env.local` isn't usable here since
// Playwright is its own process; use `npx dotenv-run` or export them first.)

const { id: userId, email, password } = JSON.parse(readFileSync(join(__dirname, ".e2e-user.json"), "utf8"));

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
  await showDoneOn(page);

  // ---- Create task ----
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", taskTitle);
  await pickAnyExecutor(page);
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
  await page.locator("#ideaInput").press("Enter");
  await expect(page.locator(".idea-item", { hasText: ideaText })).toBeVisible();

  // ---- Calendar renders ----
  await expect(page.locator(".cal-day").first()).toBeVisible();
  await expect(page.locator("#calMonthLabel")).not.toBeEmpty();

  // ---- Logout ----
  await page.click("#signOutBtn");
  await expect(page).toHaveURL(/\/login/);
});

// «Показывать завершённые» — теперь кнопка, а не галочка: включается
// нажатием и помечается aria-pressed.
async function showDoneOn(page: import("@playwright/test").Page) {
  const btn = page.locator("#showDoneCheckbox");
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
  await showDoneOn(page);
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
  await pickAnyExecutor(page);
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
  await page.locator("#ideaInput").press("Enter");
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
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  await waitForSaved(page);

  await expect(page.locator(".task", { hasText: title })).toBeVisible();

  // Open it, delete it, then sign out immediately. Подтверждение — своё окно
  // трекера, а не системное окно браузера (см. components/Ask.tsx).
  await page.locator(".task", { hasText: title }).click();
  await page.click("#deleteTaskBtn");
  await expect(page.locator(".ask-modal")).toBeVisible();
  await page.click("#askOkBtn");
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

  // Открываем заново: назначенная встреча больше не даёт менять ни название,
  // ни время, ни состав — они показаны фактом. Проверяется и то, что
  // сохранилось именно выбранное (время и участник видны в сводке), и то,
  // что редактировать их отсюда нечем: полей нет вовсе.
  await chip.click();
  await expect(page.locator(".meeting-facts")).toContainText(title);
  await expect(page.locator(".meeting-facts")).toContainText("10:00");
  await expect(page.locator(".meeting-facts")).toContainText(participant);
  await expect(page.locator("#mTimeGrid")).toHaveCount(0);
  await expect(page.locator("#mParticipants")).toHaveCount(0);
  await expect(page.locator("#mTitle")).toHaveCount(0);

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
  await showDoneOn(page);
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
  await pickAnyExecutor(page);
  // Поля — кнопки, а не списки (см. ChipChoice): выбранное помечено
  // aria-pressed, по нему и проверяется, что правило вернулось из базы.
  await page.click('#fRecur [data-value="weekly"]');
  await page.click('#fRecurWeekday [data-value="3"]');
  await page.click('#fPriority [data-value="high"]');
  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: title })).toBeVisible();
  await waitForSaved(page);

  await page.reload();
  // Правило проверяется по самой карточке, а не по полям формы: у
  // заведённой задачи полей нет вовсе (см. TaskModal — её уже отправили
  // человеку, и править её у себя в окне значит развести то, что записано,
  // и то, что он видел). Карточка говорит то же самое: пилюля повторения и
  // пилюля приоритета.
  const card = page.locator(".task", { hasText: title });
  // «По срм» — как карточка пишет «по средам»: и повтор, и день недели
  // одной пилюлей, то есть проверяются оба сохранённых поля сразу.
  await expect(card.locator(".pill-recur")).toContainText("ср");
  await expect(card).toHaveClass(/high/);
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
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: title })).toBeVisible();
  await waitForSaved(page);

  // The keyboard route, not the button: "/" is the way this is meant to be used.
  // По шапке, а не по body: см. соседний тест — середина страницы занята
  // карточкой задачи, и щелчок по ней открывает окно.
  await page.locator("header .brand").click();
  await page.keyboard.press("/");
  await expect(page.locator("#searchInput")).toBeFocused();

  await page.fill("#searchInput", "поиск");
  const hit = page.locator(".search-hit", { hasText: title });
  await expect(hit).toBeVisible();
  await hit.click();

  await expect(page.locator("#searchOverlay")).toHaveCount(0);
  // У заведённой задачи название — заголовок карточки, а не поле.
  await expect(page.locator("#modalTitle")).toHaveText(title);

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
  await pickAnyExecutor(page);
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
  await pickAnyExecutor(page);
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

// The four keys, driven as real key presses: a remap that silently stops
// working is invisible until you reach for it.
test("hotkeys open a task, a meeting and the idea field, Esc closes", async ({ page }) => {
  await login(page);
  // Щелчок ПО ШАПКЕ, а не по body: click() бьёт в середину элемента, и
  // середина страницы — это карточка задачи. Открывшаяся карточка глотает
  // горячие клавиши (обработчик молчит, когда открыто окно), и тест
  // проверял не то, что думал.
  await page.locator("header .brand").click();

  await page.keyboard.press("n");
  await expect(page.locator("#fTitle")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#fTitle")).toHaveCount(0);

  await page.keyboard.press("b");
  await expect(page.locator("#mTitle")).toBeVisible();
  // Dated, so the form is ready to save rather than complaining about a date.
  // Дата теперь календарь, а не поле: выбранный день помечен в сетке, и
  // само значение лежит на ней атрибутом.
  // Дата — всплывающий календарь: сама дата написана на кнопке, которая его
  // открывает, и лежит на обёртке атрибутом.
  await expect(page.locator("#mDate")).not.toHaveAttribute("data-value", "");
  await expect(page.locator("#mDate .mini-cal-trigger")).toContainText(/\d{2}\.\d{2}\.\d{4}/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#mTitle")).toHaveCount(0);

  await page.keyboard.press("m");
  await expect(page.locator("#ideaInput")).toBeFocused();
});

// The team screen lists who can be written to in Telegram. The owner's own
// row sits in the same assignee list (so work can be put on himself), but a
// bot cannot write to the person running it — offering to invite him was an
// offer that could never be accepted.
test("the team screen offers colleagues to invite, but never the owner himself", async ({ page }) => {
  await login(page);
  // The assignee list reaches the database on the first sync; the team
  // screen reads it from there, not from the page's own state.
  await waitForSaved(page);

  await page.click("#teamBtn");
  await expect(page.locator("#teamList")).toBeVisible();
  await expect(page.locator(".team-name", { hasText: "Игорь Витковский" })).toBeVisible();
  await expect(page.locator(".team-name", { hasText: "(я)" })).toHaveCount(0);

  await page.click("#teamCloseBtn");
  await expect(page.locator("#teamOverlay")).toHaveCount(0);
});

// The cross on a toast used to be floated into the message, and a floated
// element is painted UNDER the text of the block next to it — so the cross
// was visible, sat where it looked like it sat, and swallowed nothing: every
// click landed on the title instead. Notifications could only be waited out.
test("a notification is closed by its cross", async ({ page }) => {
  const text = `E2E тост ${Date.now()}`;

  await login(page);
  await page.fill("#ideaInput", text);
  await page.locator("#ideaInput").press("Enter");
  const idea = page.locator(".idea-item", { hasText: text });
  await expect(idea).toBeVisible();
  await idea.locator(".idea-del").click();

  const toast = page.locator(".toast", { hasText: "Идея удалена" });
  await expect(toast).toBeVisible();
  // The cross has to be the thing under the pointer at its own centre —
  // being visible there is not the same as being clickable there.
  const onTop = await page.evaluate(() => {
    const close = document.querySelector(".toast .close");
    if (!close) return false;
    const r = close.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === close;
  });
  expect(onTop).toBe(true);

  await toast.locator(".close").click();
  await expect(toast).toHaveCount(0);
});

// Sending used to be a single button that went to the task's assignee and
// nowhere else: if the person you wanted was not the assignee — or the
// assignee was in no messenger at all — the tracker could not reach them.
// Now the ✈ opens the list of everyone who is connected, with the people the
// item already concerns at the top.
test("a task can be sent to any connected colleague, not only its assignee", async ({ page }) => {
  const title = `E2E отправка ${Date.now()}`;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await login(page);
  // The default assignee list reaches the database on the first sync; the
  // colleague is connected there, the way the bot's invite would have.
  await waitForSaved(page);
  const { error } = await admin
    .from("assignees")
    .update({ telegram_chat_id: 900000000 + (Date.now() % 1000000), telegram_username: "e2e_colleague" })
    .eq("user_id", userId)
    .eq("name", "Игорь Витковский");
  expect(error).toBeNull();

  // A task addressed to nobody in particular — the point being that it can
  // still be sent.
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  await page.click(`.task:has-text("${title}")`);

  await expect(page.locator("#sendTaskBtn")).toBeVisible();
  await page.click("#sendTaskBtn");
  const menu = page.locator(".action-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".export-item", { hasText: "Игорь Витковский" })).toBeVisible();

  // Nothing is sent by opening the menu.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator("#taskSendResult")).toHaveCount(0);
});

// «Не даёт ссылку ещё раз». Ссылка выдавалась исправно — её просто печатали
// под всем списком: у четырнадцати человек это экран с лишним ниже кнопки,
// которую нажали, и с точки зрения нажавшего не происходило ничего. Теперь
// блок стоит сразу за строкой человека и сам подтягивается в видимую часть.
test("an invite link appears under the person it was asked for", async ({ page }) => {
  await login(page);
  // The assignee list reaches the database on the first sync; the team
  // screen reads it from there.
  await waitForSaved(page);

  await page.click("#teamBtn");
  await expect(page.locator("#teamList")).toBeVisible();

  // Самый нижний из неподключённых: именно там старый общий блок уезжал за
  // край. Не просто последняя строка — соседний тест может подключить
  // кого-нибудь к мессенджеру, и у подключённого кнопки другие.
  const row = page
    .locator(".team-row")
    .filter({ has: page.getByRole("button", { name: "Telegram", exact: true }) })
    .last();
  const name = (await row.locator(".team-name").innerText()).trim();
  await row.getByRole("button", { name: "Telegram", exact: true }).click();

  // Щедрый таймаут: первое обращение к маршруту — это ещё и его холодный
  // старт, а тест здесь про то, ГДЕ появляется ссылка, а не как быстро.
  const invite = page.locator("#inviteBlock");
  await expect(invite).toBeVisible({ timeout: 20_000 });
  await expect(invite).toContainText(name);
  await expect(invite.locator(".invite-link")).toContainText("t.me/");

  // Стоит непосредственно за строкой этого человека…
  expect(await row.evaluate((el) => el.nextElementSibling?.id === "inviteBlock")).toBe(true);
  // …и видна без прокрутки — в этом весь смысл.
  const inView = await invite.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  expect(inView).toBe(true);

  await page.click("#teamCloseBtn");
  await expect(page.locator("#teamOverlay")).toHaveCount(0);
});

// Вопросы задаёт трекер, а не браузер.
//
// Системное окно («Подтвердите действие на task-tracker-beta-ebon.vercel.app»
// с кнопками ОК/Отмена) — это чужой интерфейс поверх своего, в нём нельзя ни
// объяснить вопрос, ни проверить ответ, а на телефоне во встроенном браузере
// мессенджера оно может не показаться вовсе. Тест ловит две вещи разом:
// что окно своё (page.on("dialog") не срабатывает ни разу) и что оно умеет
// то, чего системное не умело, — отказываться от пустого обязательного
// ответа, не закрываясь.
test("вопросы задаются окном трекера, а не браузера", async ({ page }) => {
  const title = `E2E окно ${Date.now()}`;
  let nativeDialogs = 0;
  page.on("dialog", (d) => {
    nativeDialogs++;
    void d.dismiss();
  });

  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickAnyExecutor(page);

  // Новый раздел: сначала имя, потом выбор из двух названных возможностей —
  // вместо «ОК — личный, Отмена — рабочий», где ответ был спрятан в чужих
  // кнопках и отменить вопрос было нельзя вовсе.
  await page.click("#addSectionBtn");
  const ask = page.locator(".ask-modal");
  await expect(ask).toBeVisible();
  // Пустой обязательный ответ окно не принимает и не закрывается.
  await page.click("#askOkBtn");
  await expect(ask.locator(".ask-problem")).toBeVisible();
  await expect(ask).toBeVisible();

  await page.fill("#askInput", `Раздел ${Date.now()}`);
  await page.click("#askOkBtn");
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Рабочий" }).click();
  await expect(page.locator(".ask-modal")).toHaveCount(0);

  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: title })).toBeVisible();

  // Отмена в окне подтверждения означает «ничего не делать».
  await page.locator(".task", { hasText: title }).click();
  await page.click("#deleteTaskBtn");
  await expect(page.locator(".ask-modal")).toBeVisible();
  await page.click("#askCancelBtn");
  await expect(page.locator(".ask-modal")).toHaveCount(0);
  await page.click("#cancelBtn");
  await expect(page.locator(".task", { hasText: title })).toBeVisible();

  // …а подтверждение — удаляет.
  await page.locator(".task", { hasText: title }).click();
  await page.click("#deleteTaskBtn");
  await page.click("#askOkBtn");
  await expect(page.locator(".task", { hasText: title })).toHaveCount(0);

  expect(nativeDialogs).toBe(0);
});

// Встречу закрывают кнопкой прямо в списке — и тогда же спрашивают, чем она
// кончилась. Раньше ✓ и ✕ закрывали её молча, с пустым итогом: назавтра
// «Совещание по опту» отличалось от «Совещания по опту» только галочкой, а
// итог — единственное, что от встречи остаётся.
test("закрытие встречи из списка спрашивает итог", async ({ page }) => {
  const title = `E2E итог ${Date.now()}`;

  await login(page);
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  await page.click("#meetingSaveBtn");
  const chip = page.locator(".meeting-chip", { hasText: title });
  await expect(chip).toBeVisible();

  // Отмена в окне итога оставляет встречу в плане.
  await chip.locator(".meeting-icon-btn.success").click();
  await expect(page.locator(".ask-modal")).toBeVisible();
  await page.click("#askCancelBtn");
  await expect(chip).not.toHaveClass(/resolved/);

  await chip.locator(".meeting-icon-btn.success").click();
  await expect(page.locator(".ask-modal")).toBeVisible();
  await page.fill("#askInput", "Договорились по срокам");
  await page.click("#askOkBtn");
  await expect(chip).toHaveClass(/resolved/);
  await waitForSaved(page);

  // Итог сохранён там же, где его потом читают, — в самой встрече.
  await chip.click();
  await expect(page.locator("#mResult")).toHaveValue("Договорились по срокам");
});

// Люди в задаче: нажал — выбрал роль, нажал второй раз — снял.
//
// Так же, как у участников встречи, где кнопка просто включает и выключает
// человека. Отдельной проверки требует именно второе нажатие: раньше оно
// открывало меню, и «снять с задачи» был спрятан в нём.
test("человека ставят на задачу с ролью и снимают вторым нажатием", async ({ page }) => {
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", `E2E люди ${Date.now()}`);

  // Список людей читается своим запросом и может приехать чуть позже формы.
  const chip = page.locator("#fPeople .participant-chip", { hasText: "Игорь Витковский" });
  await expect(chip).toBeVisible({ timeout: 20_000 });

  // Первое нажатие спрашивает роль — и ничего не выбирает, пока не ответишь.
  await chip.click();
  const menu = page.locator(".export-menu, .action-sheet").first();
  await expect(menu).toBeVisible();
  await expect(chip).not.toHaveClass(/selected/);

  await menu.locator(".export-item", { hasText: "Соисполнитель" }).click();
  await expect(chip).toHaveClass(/role-coexecutor/);
  await expect(chip).toContainText("соисполнитель");

  // Второе нажатие снимает с задачи — без меню и без вопросов.
  await chip.click();
  await expect(chip).not.toHaveClass(/selected/);
  await expect(page.locator(".export-menu, .action-sheet")).toHaveCount(0);
});

// Разделы переставляются мышью — зажал и сразу потянул.
//
// Первая версия требовала подержать кнопку неподвижно четверть секунды, и
// мышью не работала вовсе: мышью «зажал и потянул» означает потянул сразу.
// Поэтому тест НЕ делает паузы после нажатия — он воспроизводит именно то
// движение, которым это делает человек.
test("разделы переставляются перетаскиванием", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ids = ["ra" + stamp, "rb" + stamp, "rc" + stamp];
  const { error } = await admin.from("sections").insert([
    { id: ids[0], user_id: userId, name: `Альфа${stamp}`, kind: "work", sort_order: 0 },
    { id: ids[1], user_id: userId, name: `Бета${stamp}`, kind: "work", sort_order: 1 },
    { id: ids[2], user_id: userId, name: `Гамма${stamp}`, kind: "work", sort_order: 2 },
  ]);
  expect(error).toBeNull();

  await login(page);
  const tabs = page.locator("#sectionTabs .section-tab");
  await expect(page.locator("#sectionTabs .section-tab", { hasText: `Гамма${stamp}` })).toBeVisible({ timeout: 20_000 });

  const src = page.locator("#sectionTabs .section-tab", { hasText: `Гамма${stamp}` });
  const dst = page.locator("#sectionTabs .section-tab", { hasText: `Альфа${stamp}` });
  const a = (await src.boundingBox())!;
  const b = (await dst.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // Никакой паузы: тянем сразу — и по обеим осям, потому что строка
  // разделов переносится и цель может оказаться на другой строке.
  const from = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const to = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + (to.x - from.x) * (i / 10), from.y + (to.y - from.y) * (i / 10), { steps: 2 });
  }
  await page.mouse.up();

  await expect(tabs.filter({ hasText: stamp }).first()).toHaveText(`Гамма${stamp}`);
  await waitForSaved(page);
  const { data } = await admin.from("sections").select("name, sort_order").in("id", ids).order("sort_order");
  expect((data || []).map((s) => s.name)[0]).toBe(`Гамма${stamp}`);

  // Нажатие без перетаскивания по-прежнему фильтрует, а не переставляет.
  await src.click();
  await expect(src).toHaveClass(/active/);

  await admin.from("sections").delete().in("id", ids);
});

// Правая кнопка по разделу — своё меню, а не браузерное.
test("раздел переименовывается и удаляется правой кнопкой", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const id = "rn" + stamp;
  await admin.from("sections").insert({ id, user_id: userId, name: `Старое${stamp}`, kind: "work", sort_order: 99 });

  await login(page);
  const tab = page.locator("#sectionTabs .section-tab", { hasText: `Старое${stamp}` });
  await expect(tab).toBeVisible({ timeout: 20_000 });

  await tab.click({ button: "right" });
  await page.locator(".export-menu .export-item", { hasText: "Редактировать" }).click();
  await expect(page.locator(".ask-modal")).toBeVisible();
  await page.fill("#askInput", `Новое${stamp}`);
  await page.click("#askOkBtn");
  const renamed = page.locator("#sectionTabs .section-tab", { hasText: `Новое${stamp}` });
  await expect(renamed).toBeVisible();
  await waitForSaved(page);

  await renamed.click({ button: "right" });
  await page.locator(".export-menu .export-item", { hasText: "Удалить" }).click();
  await expect(page.locator(".ask-modal")).toBeVisible();
  await page.click("#askOkBtn");
  await expect(page.locator("#sectionTabs .section-tab", { hasText: stamp })).toHaveCount(0);

  await admin.from("sections").delete().eq("id", id);
});

// Задача без исполнителя не заводится.
//
// Правило Кирилла, сказанное прямо: «без исполнителя запрети создавать»,
// соисполнитель и наблюдатель — по желанию. Проверяется именно отказ:
// задача с одним только названием не должна ни сохраниться, ни закрыть
// форму, а окно должно объяснить, чего не хватает. Проверка стоит и на
// правке тоже — снять единственного исполнителя и нажать «Сохранить» это
// тот же результат в два нажатия.
test("задача не сохраняется без исполнителя", async ({ page }) => {
  const title = `E2E без исполнителя ${Date.now()}`;
  await login(page);

  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  // Список людей должен успеть приехать — иначе «нет исполнителя» ничего
  // не доказывает: его и выбрать было негде.
  await expect(page.locator("#fPeople .participant-chip").first()).toBeVisible({ timeout: 20_000 });

  await page.click("#saveTaskBtn");
  await expect(page.locator(".ask-modal")).toContainText("исполнител");
  await page.click("#askOkBtn");

  // Форма осталась открытой, задача не создана.
  await expect(page.locator("#fTitle")).toHaveValue(title);
  await expect(page.locator(".task", { hasText: title })).toHaveCount(0);

  // С исполнителем — сохраняется.
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: title })).toBeVisible();
});

// Перенос — единственный путь изменить время и состав назначенной встречи.
//
// Правило Кирилла: «изменения и дополнения участниками возможны только при
// дальнейшем переносе». Проверяется вся цепочка: в открытой встрече полей
// нет, кнопка «Перенести» открывает форму новой с тем же составом, править
// там можно всё, а прежняя встреча после сохранения закрывается как
// перенесённая.
test("время и состав встречи меняются только переносом", async ({ page }) => {
  const title = `E2E перенос ${Date.now()}`;
  await login(page);

  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  await page.locator("#mTimeGrid .time-slot", { hasText: "10:00" }).click();
  const firstChip = page.locator("#mParticipants .participant-chip").first();
  const participant = (await firstChip.textContent())?.trim() || "";
  await firstChip.click();
  await page.click("#meetingSaveBtn");
  const chip = page.locator(".meeting-chip", { hasText: title });
  await expect(chip).toBeVisible();
  await waitForSaved(page);

  // Открытая встреча полей не даёт — только факт и кнопку переноса.
  await chip.click();
  await expect(page.locator("#mTitle")).toHaveCount(0);
  await expect(page.locator("#mTimeGrid")).toHaveCount(0);
  await expect(page.locator("#meetingMoveBtn")).toBeVisible();

  // Перенос открывает форму новой встречи — с тем же составом и временем.
  await page.click("#meetingMoveBtn");
  await expect(page.locator("#meetingModalTitle")).toHaveText("Перенос встречи");
  await expect(page.locator("#mTitle")).toHaveValue(title);
  await expect(page.locator("#mTimeGrid .time-slot", { hasText: "10:00" })).toHaveClass(/selected/);
  await expect(page.locator("#mParticipants .participant-chip", { hasText: participant })).toHaveClass(/selected/);

  // И тут их уже можно менять — ради чего перенос и затевался.
  await page.locator("#mTimeGrid .time-slot", { hasText: "15:30" }).click();
  await page.click("#meetingSaveBtn");
  await waitForSaved(page);

  // Новая встреча в плане и с новым временем; прежняя закрыта как
  // перенесённая (видна только при «показывать завершённые»).
  await showDoneOn(page);
  const all = page.locator(".meeting-chip", { hasText: title });
  await expect(all).toHaveCount(2);
  await expect(all.filter({ hasText: "15:30" })).toBeVisible();
  await expect(all.filter({ has: page.locator(".mstatus.no_result") })).toBeVisible();
});

test("написанное в обсуждении появляется до того, как доедет до облака", async ({ page }) => {
  const title = `E2E обсуждение ${Date.now()}`;
  const text = `сообщение ${Date.now()}`;

  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  await waitForSaved(page);

  await page.click(`.task:has-text("${title}")`);
  const composer = page.locator(".chat-composer textarea");
  await expect(composer).toBeVisible();

  // Вставка нарочно задерживается на три секунды. Проверяем ровно то, ради
  // чего всё это писалось: экран не ждёт облако. Тест без задержки ничего бы
  // не доказал — на быстрой связи и прежний, последовательный порядок
  // уложился бы в отведённое время.
  await page.route("**/item_comments*", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });

  await composer.fill(text);
  await page.click(".chat-composer .btn-primary");

  // Сообщение в ленте и поле пустое — сразу, а не через три секунды.
  await expect(page.locator(".chat-msg", { hasText: text })).toBeVisible({ timeout: 1200 });
  await expect(composer).toHaveValue("", { timeout: 1200 });
  // И пока оно едет, видно, что оно едет.
  await expect(page.locator(".chat-msg.sending", { hasText: text })).toBeVisible({ timeout: 1200 });

  // Доехало — пометка снимается, сообщение остаётся ровно одно: местная
  // копия уступает место серверной строке, а не ложится рядом с ней.
  await page.unroute("**/item_comments*");
  await expect(page.locator(".chat-msg.sending")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".chat-msg", { hasText: text })).toHaveCount(1);
});

test("«Команда» открывается на готовом списке, а не на «Загрузка…»", async ({ page }) => {
  await login(page);
  // Список людей доезжает до базы первой же синхронизацией — окно читает его
  // оттуда, а не из состояния страницы.
  await waitForSaved(page);

  await page.click("#teamBtn");
  await expect(page.locator("#teamList")).toBeVisible();
  await page.click("#teamCloseBtn");

  // Второе открытие — то, ради чего всё это: список уже спрошен, и окно
  // показывает людей, а не идёт за ними. Раньше каждое окно спрашивало само,
  // с нуля и со своим «Загрузка…», — и это было ровно то, что Кирилл видел
  // как задержку при нажатии «Команда».
  await page.click("#teamBtn");
  await expect(page.locator("#teamList")).toBeVisible({ timeout: 1000 });
  await expect(page.locator("#teamOverlay .empty", { hasText: "Загрузка" })).toHaveCount(0);
});
