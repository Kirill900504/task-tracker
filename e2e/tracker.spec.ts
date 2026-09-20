import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dayCell, dragOnto, pickAnyExecutor, pickSelfExecutor } from "./helpers";
import { userFilePath } from "./userFile";

// The one smoke test covering the actual "Definition of Done" checklist
// (login, create task, complete task, create meeting, create idea,
// calendar, logout) — see e2e/global-setup.ts for why running this against
// the live deployment is safe (an isolated, disposable test account, not
// Кирилл's real one). Run with:
//   npx playwright test --config=playwright.config.ts
// (needs NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the
// environment — e.g. `node --env-file=.env.local` isn't usable here since
// Playwright is its own process; use `npx dotenv-run` or export them first.)

const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

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
  // Себе: ниже она закрывается галочкой, а галочка на чужой работе
  // спрашивает результат (см. quickDone в TasksPanel).
  await pickSelfExecutor(page);
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
  // Задача самому себе: галочка закрывает её сразу, без вопроса о
  // результате (его спрашивают, когда закрывают чужую работу), а тесту
  // здесь важна именно мгновенность — он про гонку записи с выходом.
  await pickSelfExecutor(page);
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

  // Окно пошире: мысль лежит в правой колонке, календарь — в левой, и
  // перетащить одно в другое мышью можно только тогда, когда оба на экране
  // одновременно. У человека с монитором так и есть.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator(".idea-item", { hasText: ideaText })).toBeVisible();

  // Настоящей мышью, а не подделанными событиями.
  //
  // Раньше здесь рассылались DragEvent вручную — иначе headless-браузер не
  // воспроизводил HTML5 drag-and-drop. С переходом на pointer-события
  // (dnd-kit, см. dnd/TrackerDnd.tsx) подделывать больше нечего: перенос
  // идёт теми же движениями мыши, что и у человека, и тест наконец
  // проверяет ровно то, что происходит на экране.
  await dragOnto(page, page.locator(".idea-item", { hasText: ideaText }), dayCell(page, 15));

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
  // Закрытая встреча уходит из списка целиком: её место — окно с зелёной
  // галочкой в шапке панели («…должны показываться удобным дизайнерским
  // списком в дополнительном окне»).
  await expect(chip).toHaveCount(0);
  await waitForSaved(page);

  // И после перезагрузки она там же, с итогом, который открывается прямо
  // из этого окна.
  await page.reload();
  await expect(page.locator("#newTaskBtn")).toBeVisible();
  await page.click("#meetingsDoneBtn");
  const row = page.locator(".done-list-row", { hasText: title });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText("Договорились по срокам");
  await row.locator(".done-list-text").click();
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
  await page.click("#saveTaskBtn");
  await expect(page.locator(".task", { hasText: title })).toBeVisible();
  await waitForSaved(page);

  await page.reload();
  // Правило проверяется по самой карточке, а не по полям формы: у
  // заведённой задачи полей нет вовсе (см. TaskModal — её уже отправили
  // человеку, и править её у себя в окне значит развести то, что записано,
  // и то, что он видел).
  const card = page.locator(".task", { hasText: title });
  // «По срм» — как кубик пишет «по средам»: и повтор, и день недели
  // одной подписью, то есть проверяются оба сохранённых поля сразу.
  await expect(card.locator(".task-recur")).toContainText("ср");
});

// Перенос задачи между столбцами — мышью, как человек.
//
// До 19.09.2026 это был HTML5 drag-and-drop, и проверить его настоящими
// движениями было нельзя: приходилось рассылать поддельные события. Теперь
// перенос идёт на pointer-событиях (dnd/TrackerDnd.tsx), и тест делает ровно
// то же, что рука: берёт карточку, ведёт в соседний столбец, отпускает.
// Проверяется и то, что видно в процессе, — поднятая карточка под курсором
// и силуэт на её месте: ради этого вида всё и переписывалось.
test("задача переносится в соседний столбец и остаётся там после перезагрузки", async ({ page }) => {
  const title = `E2E перенос ${Date.now()}`;

  await login(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");

  const card = page.locator(".task", { hasText: title });
  // Задача поставлена на другого человека, значит она «Новая»: её ещё
  // никто не взял.
  await expect(page.locator("#col-new .task", { hasText: title })).toBeVisible();
  await waitForSaved(page);

  // В процессе: карточка поднята, на её месте силуэт, а в столбце, куда
  // целятся, раскрылось место под неё. Проверяется до отпускания, потому
  // что после него всё это исчезает — а именно это Кирилл и увидит
  // глазами. Подсветки столбца здесь больше нет намеренно: 20.09.2026 он
  // попросил убрать «контуры и зонирование», и ответ на «куда встанет»
  // дают расступившиеся соседи, а не рамка вокруг половины экрана.
  await card.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!;
  await page.mouse.move(from.x + 60, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + 75, from.y + 30, { steps: 5 });
  await page.waitForTimeout(150);
  const target = (await page.locator("#col-work .task-column-body").boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + 40, { steps: 12 });
  await page.waitForTimeout(300);

  await expect(page.locator(".dnd-card-ghost .task-title")).toHaveText(title);
  await expect(page.locator(".task.dragging")).toHaveCount(1);
  await expect(page.locator("#col-work .task-drop-slot.open")).toHaveCount(1);

  await page.mouse.up();

  // И вот главное отличие доски от трёх ящиков: перенос — это действие, а
  // не перекладывание ярлыка. Взять задачу в работу может только её
  // исполнитель; постановщик, сделавший это за него, отчитался бы за
  // другого. Поэтому карточка остаётся на месте, а трекер говорит почему.
  // Именно этот тост, а не «первый попавшийся»: рядом живёт ещё один —
  // «сейчас ночь, задача уйдёт утренней сводкой», — и он приходит от
  // создания задачи, а не от переноса.
  await expect(page.locator(".toast", { hasText: "Так нельзя" })).toBeVisible();
  await expect(page.locator("#col-new .task", { hasText: title })).toBeVisible();
  await expect(page.locator("#col-work .task", { hasText: title })).toHaveCount(0);
});

// Перестановка ВНУТРИ столбца — и проверка, что экран при этом жив.
//
// 19.09.2026 именно здесь трекер падал в белый экран «This page couldn't
// load»: предпросмотр вставлял карточку перед соседкой, под курсором
// оказывалась она сама, «перед собой» означало «в конец» — и список скакал
// туда-сюда, пока React не сдавался с ошибкой #185 (превышена глубина
// обновлений). Нужны минимум три карточки: на двух петле не за что
// зацепиться, и поэтому её не поймал ни один из прежних тестов.
test("задача переставляется внутри столбца, и список не идёт вразнос", async ({ page }) => {
  const stamp = Date.now();
  const titles = [`E2E порядок A ${stamp}`, `E2E порядок B ${stamp}`, `E2E порядок C ${stamp}`];

  await login(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  // Все три — в столбец «Новые»: задача, поставленная на другого
  // человека, до его ответа лежит именно там.
  for (const title of titles) {
    await page.click("#newTaskBtn");
    await page.fill("#fTitle", title);
    await pickAnyExecutor(page);
    await page.click("#saveTaskBtn");
    await expect(page.locator("#col-new .task", { hasText: title })).toBeVisible();
  }
  await waitForSaved(page);

  // Тянем СВОИ карточки, а не первые попавшиеся: аккаунт на весь прогон
  // один, и в столбце лежат задачи соседних тестов. И порядок берётся
  // фактический, а не порядок создания: сортировка столбца — не «кто
  // раньше завёл», и тест, который это путает, ловит то вверх, то вниз.
  const mineCard = (title: string) => page.locator("#col-new .task", { hasText: title });
  const shown = await page.locator("#col-new .task .task-title").allTextContents();
  const mineShown = titles.slice().sort((x, y) => shown.indexOf(x) - shown.indexOf(y));
  const [upper, lower] = [mineShown[0], mineShown[1]];

  await mineCard(upper).scrollIntoViewIfNeeded();
  const a = (await mineCard(upper).boundingBox())!;

  await page.mouse.move(a.x + 60, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + 70, a.y + 34, { steps: 5 });
  await page.waitForTimeout(150);
  // Карточка должна быть в руке. Без этой проверки провалившийся захват
  // выглядит как «порядок не изменился» — и час уходит на поиски причины
  // не там.
  await expect(page.locator(".dnd-card-ghost"), "карточку не удалось взять").toBeVisible();
  // Соседка измеряется ПОСЛЕ того, как карточку взяли: в длинном столбце
  // (а в общем прогоне он полон задач соседних тестов) страница к этому
  // моменту могла проехать автопрокруткой, и прямоугольник, снятый заранее,
  // указывает в пустоту.
  //
  // Целимся в нижнюю её часть, а не в середину: пока карточку ведут, соседи
  // отъезжают, и точка «ровно центр» оказывается там, где соседки уже нет.
  const b = (await mineCard(lower).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.8, { steps: 10 });
  await page.waitForTimeout(200);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.85);

  // Курсор стоит — значит и список обязан стоять. Если он шевелится сам,
  // это петля, и она уронит страницу через несколько десятков кругов.
  const order = () => page.evaluate(() => [...document.querySelectorAll("#col-new .task .task-title")].map((el) => el.textContent).join("|"));
  await page.waitForTimeout(400);
  const settled = await order();
  await page.waitForTimeout(600);
  expect(await order(), "список переставляет себя сам — вернулась петля").toBe(settled);

  await page.mouse.up();
  await waitForSaved(page);

  // Карточка встаёт НА место соседки, а не перед ней: верхняя, брошенная
  // на нижнюю, оказывается ПОД ней. Сравниваются только свои две — чужие
  // задачи в столбце этому не мешают.
  const after = await page.locator("#col-new .task .task-title").allTextContents();
  expect(after.indexOf(lower), "нижняя должна была подняться над верхней").toBeLessThan(after.indexOf(upper));
  // И страница жива — ровно то, что переставало быть правдой.
  await expect(page.locator("#newTaskBtn")).toBeVisible();
});

// Карточка, прилипшая к курсору.
//
// 20.09.2026 Кирилл сделал снимок экрана (Win+Shift+S) посреди
// перетаскивания, и кнопка мыши отпустилась НЕ над трекером: «эта нижняя
// строка приклеилась к курсору и летала по экрану вместо курсора».
// Отпускание в таком случае достаётся тому окну, которое забрало
// указатель, до страницы оно не доходит вовсе, и перенос остаётся
// начатым — выйти из него можно только перезагрузкой. Сторож — потеря
// фокуса окном, и проверяется он именно так: взяли карточку, окно
// потеряло фокус, поднятая карточка обязана исчезнуть.
test("перенос отменяется, если окно потеряло фокус посреди него", async ({ page }) => {
  const title = `E2E прилипание ${Date.now()}`;
  await login(page);
  await page.setViewportSize({ width: 1600, height: 1000 });

  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator("#col-new .task", { hasText: title });
  await expect(card).toBeVisible();
  await waitForSaved(page);

  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 6 });
  await expect(page.locator(".dnd-card-ghost"), "карточку не удалось взять").toBeVisible();

  // Ровно то, что делает снимок экрана: фокус ушёл из окна.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".dnd-card-ghost"), "карточка осталась висеть на курсоре").toHaveCount(0);

  // И отпущенная кнопка уже ничего не переносит — задача на месте.
  await page.mouse.up();
  await expect(page.locator("#col-new .task", { hasText: title })).toBeVisible();
});

// Цитата в шапке подбирает себе кегль замером (HeaderQuote.tsx), и ошибается
// этот замер молча: строка либо торчит за край, обрезанная на последнем
// слове, либо сжимается до нечитаемых десяти пикселей — ровно это Кирилл и
// прислал снимком 19.09.2026 («опять сжалась»). Ни то, ни другое не
// обнаруживается ничем, кроме взгляда, поэтому проверяется здесь: на трёх
// ширинах, где цитата стоит в ряду с кнопками, уходит на свою строку и
// живёт рядом с переносом шапки.
test("цитата в шапке не обрезается и не мельчает ни на одной ширине", async ({ page }) => {
  await login(page);

  for (const width of [1920, 1500, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    // Кегль пересчитывается через ResizeObserver, то есть на следующем
    // кадре, а не в момент изменения размера.
    await page.waitForTimeout(600);

    const state = await page.evaluate(() => {
      const box = document.querySelector(".header-quote");
      const line = document.querySelector(".hqline");
      if (!box || !line) return null;
      return {
        lineWidth: line.getBoundingClientRect().width,
        boxWidth: box.clientWidth,
        size: parseFloat(getComputedStyle(line).fontSize),
        visible: getComputedStyle(line).visibility !== "hidden",
      };
    });

    expect(state, `цитата пропала из шапки на ${width}`).not.toBeNull();
    expect(state!.visible, `цитата спряталась на ${width}`).toBe(true);
    // Пол-пикселя допуска: ширины дробные, и равенство «впритык» округляется
    // в обе стороны.
    expect(state!.lineWidth, `строка торчит за край на ${width}`).toBeLessThanOrEqual(state!.boxWidth + 0.5);
    expect(state!.size, `кегль ушёл в нечитаемый на ${width}`).toBeGreaterThanOrEqual(15);
  }
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
// Щелчок мимо окна не выбрасывает заполненную форму.
//
// 20.09.2026: «почти заполнил задачу, случайно тыкнул мимо окна и потерял
// всю заполненную форму, и всё по новой заполнять». Щелчок мимо — самое
// лёгкое движение из возможных, а цена у него была наибольшей: десяток
// полей исчезал без вопроса и без отмены. Закрывают «Отменой» и Escape,
// оба нарочно; у окон, которые только показывают, щелчок мимо остался.
test("щелчок мимо не закрывает форму, но закрывает окно-список", async ({ page }) => {
  const title = `E2E щелчок мимо ${Date.now()}`;
  await login(page);
  await page.setViewportSize({ width: 1600, height: 1000 });

  // Форма задачи: набранное остаётся на месте.
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await page.mouse.click(40, 500);
  await expect(page.locator("#fTitle")).toBeVisible();
  await expect(page.locator("#fTitle")).toHaveValue(title);
  await page.keyboard.press("Escape");
  await expect(page.locator("#fTitle")).toHaveCount(0);

  // Форма встречи — то же правило.
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  await page.mouse.click(40, 500);
  await expect(page.locator("#mTitle")).toHaveValue(title);
  await page.keyboard.press("Escape");
  await expect(page.locator("#mTitle")).toHaveCount(0);

  // А окно, которое только показывает, закрывается щелчком мимо: терять
  // там нечего. «Завершённые» у мыслей есть не всегда, поэтому берём
  // «Команду» — она есть у владельца всегда.
  await page.click("#teamBtn");
  await expect(page.locator("#teamOverlay .modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#teamOverlay")).toHaveCount(0);
});

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
  await chip.locator(".meeting-act.success").click();
  await expect(page.locator(".ask-modal")).toBeVisible();
  await page.click("#askCancelBtn");
  await expect(chip).not.toHaveClass(/resolved/);

  await chip.locator(".meeting-act.success").click();
  await expect(page.locator(".ask-modal")).toBeVisible();
  await page.fill("#askInput", "Договорились по срокам");
  await page.click("#askOkBtn");
  // Закрытая встреча уходит из списка в окно завершённых.
  await expect(chip).toHaveCount(0);
  await waitForSaved(page);

  // Итог сохранён там же, где его потом читают, — в самой встрече.
  await page.click("#meetingsDoneBtn");
  await page.locator(".done-list-row", { hasText: title }).locator(".done-list-text").click();
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
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // Порог в шесть пикселей — сначала преодолеть его, и только потом
  // целиться: до него dnd-kit не считает это переносом вовсе.
  await page.mouse.move(a.x + a.width / 2 - 10, a.y + a.height / 2, { steps: 4 });
  await page.waitForTimeout(150);

  // Ведём к ПЕРВОМУ разделу ряда, медленно и с остановками.
  //
  // И то, и другое — не перестраховка, а то, как эта перестановка
  // устроена (SectionTabs): она смотрит, какая кнопка сейчас ПОД
  // курсором, и меняет порядок местами с ней. Отсюда две вещи, на
  // которых тест и падал через раз.
  //
  // Первая: после обмена перетаскиваемый раздел встаёт ровно туда, где
  // курсор, и дальше курсор ездит внутри него самого — а над собой
  // обмена не бывает. Чтобы сделать второй шаг, надо выйти за его край,
  // и целиться поэтому надо не в середину соседа, а в НАЧАЛО ряда.
  //
  // Вторая: «какая кнопка под курсором» читается из настоящего DOM, а
  // перестроить его должен React. Если гнать мышь без пауз, все события
  // приходят раньше первой же перерисовки, и каждое следующее считается
  // по ряду, которого на экране уже нет: раздел переезжал на одну
  // позицию и замирал. Рука столько событий в секунду не производит, а
  // Playwright производит — отсюда паузы между шагами.
  //
  // Цель — левый край первого раздела, а не край всей строки: у кнопки
  // «Все» нет data-section-id, и остановка на ней не считается ничем.
  const first = (await page.locator("#sectionTabs .section-tab[data-section-id]").first().boundingBox())!;
  const from = { x: a.x + a.width / 2 - 10, y: a.y + a.height / 2 };
  const to = { x: first.x + 6, y: first.y + first.height / 2 };
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + (to.x - from.x) * (i / 12), from.y + (to.y - from.y) * (i / 12));
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
  await page.mouse.up();

  await expect(tabs.filter({ hasText: stamp }).first()).toHaveText(`Гамма${stamp}`);
  await waitForSaved(page);
  const { data } = await admin.from("sections").select("name, sort_order").in("id", ids).order("sort_order");
  expect((data || []).map((s) => s.name)[0]).toBe(`Гамма${stamp}`);

  // Нажатие без перетаскивания по-прежнему делает своё дело, а не
  // переставляет: правая кнопка отбирает задачи раздела (с 20.09.2026
  // левая заводит задачу — см. следующий тест).
  await src.click({ button: "right" });
  await expect(src).toHaveClass(/active/);

  await admin.from("sections").delete().in("id", ids);
});

// Разделы: левая кнопка заводит задачу, правая отбирает, правятся они в
// своём окне.
//
// Кнопки менялись местами дважды. 19.09.2026 правая получила «новую
// задачу» вместо меню «переименовать / удалить», а 20.09.2026 Кирилл
// поменял и оставшиеся две: «если левой кнопкой мыши — создаётся задача,
// если правой — делается отбор». Редкое действие живёт в окне «Разделы»,
// частые — под обеими кнопками мыши.
test("левая кнопка по разделу заводит задачу, правая отбирает, переименование живёт в окне «Разделы»", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const id = "rn" + stamp;
  await admin.from("sections").insert({ id, user_id: userId, name: `Старое${stamp}`, kind: "work", sort_order: 99 });

  await login(page);
  const tab = page.locator("#sectionTabs .section-tab", { hasText: `Старое${stamp}` });
  await expect(tab).toBeVisible({ timeout: 20_000 });

  // Дать строке разделов устояться. Она только что приехала из базы и
  // пересортировалась по sort_order, а нажатие, попавшее в перерисовку,
  // теряется целиком: pointerdown достаётся старому узлу, pointerup —
  // новому, и onClick не случается вовсе. Рука в это окно почти не
  // попадает, тест попадает всегда.
  await page.waitForTimeout(800);

  // Левая кнопка — новая задача, и раздел в ней уже выбран.
  await tab.click();
  await expect(page.locator("#fTitle")).toBeVisible();
  await expect(page.locator(`#fSection [data-value="${id}"]`)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#fTitle")).toHaveCount(0);

  // Правая — отбор по разделу, и повторная его снимает.
  await tab.click({ button: "right" });
  await expect(tab).toHaveClass(/active/);
  await tab.click({ button: "right" });
  await expect(tab).not.toHaveClass(/active/);

  // И «Все» снимает отбор той же кнопкой, которой он поставлен: рука,
  // выбравшая раздел правой, снимает выбор правой же.
  const all = page.locator("#sectionTabs .section-tab", { hasText: /^Все$/ });
  await tab.click({ button: "right" });
  await expect(tab).toHaveClass(/active/);
  await all.click({ button: "right" });
  await expect(all).toHaveClass(/active/);
  await expect(tab).not.toHaveClass(/active/);

  // А переименование — в окне «Разделы», прямо в строке раздела.
  await page.click("#sectionSettingsBtn");
  const row = page.locator(`.section-row[data-section-id="${id}"]`);
  await expect(row).toBeVisible();
  const nameField = row.locator("input.section-row-name");
  await expect(nameField).toHaveValue(`Старое${stamp}`);
  await nameField.fill(`Новое${stamp}`);
  await expect(page.locator("#sectionTabs .section-tab", { hasText: `Новое${stamp}` })).toBeVisible();
  await waitForSaved(page);

  // И строка раздела помещается в одну строку: он попросил об этом прямо,
  // увидев одиннадцать разделов, у половины которых «Удалить» уехала вниз.
  // Меряется это не глазами, а высотой: ряд, поместившийся в строку, не
  // выше своей самой высокой кнопки.
  const head = row.locator(".section-row-head");
  const headBox = (await head.boundingBox())!;
  const btnBox = (await row.getByRole("button", { name: "Удалить" }).boundingBox())!;
  expect(headBox.height).toBeLessThan(btnBox.height * 1.6);

  // Ответственные за раздел — то же поле, что и люди на задаче, и в нём
  // видны ВСЕ. Прежнее окно показывало первых двенадцать из списка, и двое
  // последних для раздела просто не существовали: «когда пытаюсь привязать
  // человека, показывает не всех людей». Поэтому проверяются именно те, кто
  // стоит в хвосте списка.
  await row.getByRole("button", { name: /^Люди/ }).click();
  const grid = row.locator(".participant-grid");
  await expect(grid.locator(".participant-chip", { hasText: "Оксана Нишкомаева" })).toBeVisible({ timeout: 20_000 });
  await expect(grid.locator(".participant-chip", { hasText: "Сергей Титов" })).toBeVisible();

  // И выбор доходит до базы: роль спрашивается тем же меню, что на задаче,
  // а счётчик на кнопке — это уже сохранённая строка.
  await grid.locator(".participant-chip", { hasText: "Оксана Нишкомаева" }).click();
  await page.locator(".export-menu, .action-sheet").first().locator(".export-item", { hasText: "Наблюдатель" }).click();
  await expect(row.getByRole("button", { name: /^Люди/ })).toContainText("1");

  // И удаление — там же, рядом.
  await row.getByRole("button", { name: "Удалить" }).click();
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

// Галочка на задаче, поручённой другому, требует результата.
//
// Слова Кирилла 20.09.2026: «если задача поставлена не самому себе, а
// другому участнику, должно требоваться заполнение „Результата“». Своя
// задача закрывается одним нажатием, чужая работа — нет: человек ждёт
// ответа, и закрытая молча задача выглядит для него отменённой.
test("закрыть галочкой задачу другого человека можно только с результатом", async ({ page }) => {
  const title = `E2E результат ${Date.now()}`;
  await login(page);

  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  // pickAnyExecutor ставит ПЕРВОГО человека из списка — не себя, поэтому
  // задача и оказывается поручённой другому.
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await waitForSaved(page);

  // Отмена оставляет задачу открытой: закрытие «передумал» не считается.
  await card.locator(".check").click();
  await expect(page.locator(".ask-modal")).toContainText("Что сделано");
  await page.click("#askCancelBtn");
  await expect(page.locator("#col-new .task", { hasText: title })).toBeVisible();

  // С результатом — задача закрывается и уезжает в «Завершённые».
  await card.locator(".check").click();
  await expect(page.locator(".ask-modal")).toBeVisible();
  await page.fill("#askInput", "Прайс согласован, отправили клиенту");
  await page.click("#askOkBtn");
  await expect(page.locator("#col-done .task", { hasText: title })).toBeVisible({ timeout: 15_000 });
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
  // В списке остаётся одна встреча — новая: прежняя закрыта как
  // перенесённая и лежит в окне завершённых, вместе с датой, на которую
  // её перенесли.
  const all = page.locator(".meeting-chip", { hasText: title });
  await expect(all).toHaveCount(1);
  await expect(all.filter({ hasText: "15:30" })).toBeVisible();
  await page.click("#meetingsDoneBtn");
  await expect(page.locator(".done-list-row", { hasText: title })).toHaveCount(1);
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

// Своё имя видно и правится — там же, где видно чужие.
//
// Вопрос Кирилла 20.09.2026: «а другие пользователи же видят меня как
// Кирилл Кучеренко? или как они меня видят?». Ответа не было нигде: своя
// строка из «Команды» вырезалась, а переименовать человека было нельзя
// ниоткуда вообще — ни себя, ни коллегу с опечаткой в фамилии.
//
// Проверяется здесь именно связка: строка «это вы» существует, и имя,
// поменянное в ней, доезжает до базы. Пометка «(я)» при этом остаётся в
// базе и не показывается: по ней трекер находит собственную строку
// владельца, а читают список все.
test("своё имя видно в «Команде» и меняется оттуда же", async ({ page }) => {
  await login(page);
  await waitForSaved(page);

  await page.click("#teamBtn");
  const myRow = page.locator("#teamList .team-row", { hasText: "это вы" });
  await expect(myRow).toBeVisible();
  await expect(myRow.locator(".team-name")).not.toContainText("(я)");

  const stamp = Math.random().toString(36).slice(2, 8);
  await myRow.locator(".team-more").click();
  await page.locator(".export-menu .export-item, .action-sheet .export-item").filter({ hasText: /^Имя$/ }).click();
  await page.fill(".ask-modal input", `Кирилл Тестовый ${stamp}`);
  await page.click("#askOkBtn");

  await expect(page.locator("#teamList .team-row", { hasText: "это вы" }).locator(".team-name")).toHaveText(
    `Кирилл Тестовый ${stamp}`,
  );

  // И в базе — с пометкой на месте: без неё перестанут работать и «Сделал»
  // по задаче, поставленной владельцу, и правило «себе не пишут».
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Экран отвечает раньше облака: имя в списке меняется сразу, а запись
  // идёт следом (см. rename в useColleagues). Поэтому базу спрашиваем с
  // ожиданием — иначе тест ловит момент до записи и читается как поломка.
  await expect
    .poll(
      async () => {
        const { data } = await admin.from("assignees").select("name").eq("user_id", userId).ilike("name", "%(я)%");
        return (data || []).map((r) => r.name);
      },
      { timeout: 10_000 },
    )
    .toContain(`Кирилл Тестовый ${stamp} (я)`);
});

// Окно ПК уменьшается ступенями и остаётся окном ПК.
//
// Слова Кирилла 20.09.2026: «мне не нравится, как сжимается приложение
// компьютерной версии… на каком-то этапе сжатия я заметил, что приложение
// для ПК переделывается под мобильную версию» и «не хочу, чтобы при сжатии
// или расширении все блоки беспорядочно гуляли».
//
// Проверяется здесь не красота, а два свойства, которые ломаются молча:
// на каждой ширине выше порога телефона ЕСТЬ раскладка (доска на месте,
// вкладок внизу нет) и НЕТ горизонтальной прокрутки. Второе — главный
// признак того, что что-то не поместилось: на экране это выглядит как
// «блоки уехали», а в коде не выглядит никак.
test("окно ПК перестраивается ступенями, а не превращается в телефон", async ({ page }) => {
  await login(page);
  // Без четвёртого столбца: login() включает «Завершённые» для остальных
  // тестов, а здесь считается именно путь задачи — три столбца.
  const doneBtn = page.locator("#showDoneCheckbox");
  if ((await doneBtn.getAttribute("aria-pressed")) === "true") await doneBtn.click();

  // Ширины взяты по ступеням: три колонки, две, две узких, одна.
  for (const width of [1500, 1200, 1000, 860]) {
    await page.setViewportSize({ width, height: 900 });
    // Ступень включается медиазапросом, то есть на следующем кадре.
    await page.waitForTimeout(300);

    // Это по-прежнему компьютер: доска на месте, вкладок под пальцем нет.
    await expect(page.locator("#mainCol"), `доска пропала на ${width}`).toBeVisible();
    await expect(page.locator("#mobileNav"), `на ${width} включились вкладки телефона`).toHaveCount(0);
    await expect(page.locator("#mobileHeader"), `на ${width} включилась шапка телефона`).toHaveCount(0);

    // Ничего не торчит вбок.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `на ${width} появилась горизонтальная прокрутка`).toBeLessThanOrEqual(1);

    // Встречи и мысли остаются на всех ступенях: уходит только календарь,
    // и только там, где колонок стало две.
    await expect(page.locator("#meetingsPanel"), `встречи пропали на ${width}`).toBeVisible();
    await expect(page.locator("#ideasPanel"), `мысли пропали на ${width}`).toBeVisible();
    // Календарь виден до 1100: на первой ступени он не исчезает, а
    // опускается под мысли — 1280 и 1366 это обычный ноутбук, и пропавшая
    // панель там читалась бы как поломка.
    const calVisible = await page.locator("#calPanel").isVisible();
    expect(calVisible, `календарь на ${width} повёл себя не по ступени`).toBe(width > 1100);

    // И доска остаётся доской: три столбца — это путь задачи, и терять
    // его на ровном месте нельзя. Ради этого календарь и уступает место.
    const boardCols = await page.evaluate(
      () => getComputedStyle(document.querySelector(".columns")!).gridTemplateColumns.split(" ").length,
    );
    expect(boardCols, `доска на ${width} потеряла столбец`).toBe(3);
  }

  // А ниже порога — вкладки, и это уже телефон.
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.locator("#mobileNav")).toBeVisible();
});
