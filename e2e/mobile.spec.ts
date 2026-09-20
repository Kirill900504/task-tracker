import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { pickAnyExecutor, pickSelfExecutor } from "./helpers";
import { userFilePath } from "./userFile";

// The phone layout is a different tree, not a narrower one — its own header,
// its own navigation, its own first screen — so it needs its own tests. The
// disposable account and the base URL are the same ones the desktop suite
// uses (see e2e/global-setup.ts).
const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#mobileNav")).toBeVisible({ timeout: 20_000 });
}

test("the phone gets its own shell: compact header, tabs, and tasks first", async ({ page }) => {
  await login(page);

  // The desktop header — logo, quote and eight buttons — is not there.
  await expect(page.locator("#mobileHeader")).toBeVisible();
  await expect(page.locator(".header-quote")).toHaveCount(0);

  // Сессия начинается с задач: «он же всегда должен быть главной
  // страницей и с него начинаться каждая сессия» (20.09.2026).
  await expect(page.locator('.mobile-tab[data-tab="tasks"]')).toHaveClass(/active/);
  await expect(page.locator("#mainCol")).toBeVisible();

  // Порядок вкладок продиктован им же и повторяет расположение блоков на
  // компьютере. Проверяется целиком, а не по одной: порядок — это и есть
  // всё требование, и перепутанная пара внутри него ничем себя не выдаст.
  const tabs = await page.locator(".mobile-tab .mobile-tab-label").allTextContents();
  expect(tabs).toEqual(["Встречи", "Задачи", "Приёмка", "Мысли", "Сегодня"]);

  // Значки — свои, контурные: ни одного эмодзи из системного шрифта.
  await expect(page.locator(".mobile-tab .mobile-tab-icon svg")).toHaveCount(5);

  // Кнопка в шапке одна, и у неё есть лицо — «вместо кнопок Лупы и „…“
  // оставить одну кнопку с картинкой команды». Поиск при этом не потерян:
  // он первой строкой в её меню.
  await expect(page.locator(".mobile-header button")).toHaveCount(1);
  await expect(page.locator("#mobileSearchBtn")).toHaveCount(0);
  await page.click("#mobileMoreBtn");
  await expect(page.locator("#mobileMoreMenu")).toBeVisible();
  await expect(page.locator(".export-item", { hasText: "Команда" })).toBeVisible();
  await expect(page.locator(".export-item", { hasText: "Поиск по трекеру" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#mobileMoreMenu")).toHaveCount(0);

  // Пальцами не увеличивается (20.09.2026). Проверяется описание окна, а
  // не сам жест: жеста у Playwright нет, а именно это описание браузер и
  // читает.
  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewportMeta).toContain("maximum-scale=1");
  expect(viewportMeta).toContain("user-scalable=no");

  // Nothing may stick out sideways: a horizontal scrollbar on a phone is the
  // classic sign of a desktop layout squeezed into it.
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});

// Что с телефона убрано — и убрано именно там, где Кирилл на это показал.
//
// Проверка на отсутствие выглядит пустой, но здесь она главная: каждая
// строка тут — отдельная его фраза, и вернуть любую из этих вещей можно
// одной случайной правкой, которая нигде больше себя не проявит.
test("на телефоне убрано всё, что дублирует подпись вкладки", async ({ page }) => {
  await login(page);

  // Задачи: вместо кнопки во всю ширину — «+», рядом только «Все / Мне /
  // Я поручил» и «Просрочено». Ни «Загрузки», ни «Завершённых», ни самой
  // кнопки «Фильтры» (сворачивать стало нечего).
  await expect(page.locator("#newTaskBtn")).toBeVisible();
  const addBox = await page.locator("#newTaskBtn").boundingBox();
  expect(addBox!.width).toBeLessThan(80);
  expect(addBox!.height).toBeGreaterThanOrEqual(40);
  await expect(page.locator("#filterOverdueBtn")).toBeVisible();
  await expect(page.locator("#mobileFiltersBtn")).toHaveCount(0);
  await expect(page.locator("#loadBtn")).toHaveCount(0);
  await expect(page.locator("#showDoneCheckbox")).toHaveCount(0);
  // И четвёртого столбца доски нет вовсе.
  await expect(page.locator(".board-tab", { hasText: "Завершённые" })).toHaveCount(0);

  // Встречи: ни календаря месяца, ни полосы «Встречи N + ✓».
  await page.click('[data-tab="meetings"]');
  await expect(page.locator("#calPanel")).toHaveCount(0);
  await expect(page.locator("#addMeetingBtn")).toHaveCount(0);
  await expect(page.locator("#meetingsDoneBtn")).toHaveCount(0);

  // Мысли: первым на экране поле, а не заголовок с числом.
  await page.click('[data-tab="ideas"]');
  await expect(page.locator("#ideaInput")).toBeVisible();
  await expect(page.locator("#ideasDoneBtn")).toHaveCount(0);

  // Приёмка: без строки «Ждут вашей приёмки N».
  await page.click('[data-tab="review"]');
  await expect(page.locator(".review-screen .section-title")).toHaveCount(0);
});

// Круглая «+» заводит то, в каком разделе её нажали.
test("круглая «+» создаёт событие того раздела, где нажата", async ({ page }) => {
  await login(page);

  // Задачи → форма задачи.
  await page.click(".quick-add-fab");
  await expect(page.locator("#fTitle")).toBeVisible();
  await page.keyboard.press("Escape");

  // Встречи → форма встречи.
  await page.click('[data-tab="meetings"]');
  await page.click(".quick-add-fab");
  await expect(page.locator("#mTitle")).toBeVisible();
  await page.keyboard.press("Escape");

  // Мысли → курсор в поле: заводить там нечем, и «создать» значит именно
  // это.
  await page.click('[data-tab="ideas"]');
  await page.click(".quick-add-fab");
  await expect(page.locator("#ideaInput")).toBeFocused();

  // В «Сегодня» и «Приёмке» кнопки нет: заводить там нечего.
  await page.click('[data-tab="review"]');
  await expect(page.locator(".quick-add-fab")).toHaveCount(0);
  await page.click('[data-tab="today"]');
  await expect(page.locator(".quick-add-fab")).toHaveCount(0);
});

test("tabs switch sections and a task can be created from the phone", async ({ page }) => {
  const title = `E2E моб ${Date.now()}`;

  await login(page);

  await page.click('[data-tab="tasks"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible();

  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickAnyExecutor(page);
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
  // Себе: свайп, как и галочка, закрывает задачу сразу только у своей
  // работы — у чужой он спросил бы результат (см. quickDone).
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  // И искать её надо в «В работе», а не в «Новых»: задача, поставленная
  // самому себе, минует этот столбец — «Новые» означает «отправлена,
  // ждём ответа человека», а отвечать тут некому (см. lib/kanban). На
  // телефоне столбец показывается один, поэтому переключаем вкладку.
  await page.locator(".board-tab", { hasText: "В работе" }).click();
  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();

  // Дать карточке устояться, и это не перестраховка.
  //
  // Только что созданная задача ещё доезжает: сохраняется сама строка,
  // следом заводится участие, следом приходит realtime и панель
  // пересчитывает столбцы. Жест, попавший в эту секунду, теряется —
  // карточку перерисовывают между «повёл» и «отпустил», и отпускание
  // приходит узлу, которого уже нет в документе. Руке это почти не
  // грозит (человек не свайпает через сотую долю секунды после
  // сохранения), а тесту грозит всегда: он именно что мгновенный.
  await expect(card).not.toHaveClass(/just-created/, { timeout: 10_000 });
  await page.waitForTimeout(1200);

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

  // Задача уходит из столбца — это видимый результат жеста…
  await expect(card).toHaveCount(0);

  // …а закрыта ли она на самом деле, спрашивается у базы, а не у экрана.
  // Раньше проверка шла через «Показать завершённые» и класс на карточке,
  // и с четырьмя столбцами доски перестала что-либо значить: на телефоне
  // виден один столбец, и найденная карточка могла оказаться какой
  // угодно. Свайп отвечает за одно — что задача закрыта; где после этого
  // рисуется её карточка, проверяют тесты доски.
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await expect
    .poll(
      async () => {
        const { data } = await admin.from("tasks").select("status").eq("title", title).maybeSingle();
        return data?.status ?? "";
      },
      { timeout: 20_000, message: "свайп должен был закрыть задачу" },
    )
    .toBe("done");
});

test("a thought becomes a task from its own menu — the drag a finger cannot do", async ({ page }) => {
  const text = `E2E мысль ${Date.now()}`;

  await login(page);
  await page.click('[data-tab="ideas"]');
  await page.fill("#ideaInput", text);
  await page.locator("#ideaInput").press("Enter");
  const item = page.locator(".idea-item", { hasText: text });
  await expect(item).toBeVisible();

  await item.locator("[data-convert-idea]").click();
  // On a phone the menu is a sheet along the bottom edge, not a dropdown
  // hanging off a 20px icon.
  await expect(page.locator(".action-sheet")).toBeVisible();
  await page.click(".action-sheet .export-item:has-text('Сделать задачей')");

  // The thought is consumed by the conversion, exactly as it is when it is
  // dragged into a column with a mouse.
  await expect(item).toHaveCount(0);
  await page.click('[data-tab="tasks"]');
  await expect(page.locator("#col-new .task", { hasText: text })).toBeVisible();
});

// Ручной порядок с телефона.
//
// Раньше это же меню умело переносить задачу между «краткосрочными» и
// «долгосрочными». Столбцов с такими названиями больше нет, а столбец
// доски — это состояние задачи: пунктом меню его не меняют, иначе
// получилось бы «отчитаться за человека нажатием».
test("a task is moved to the top of its column from the card menu", async ({ page }) => {
  const title = `E2E меню ${Date.now()}`;

  await login(page);
  await page.click('[data-tab="tasks"]');
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator("#col-new .task", { hasText: title });
  await expect(card).toBeVisible();

  await card.locator("[data-task-menu]").click();
  await page.click(".action-sheet .export-item:has-text('Наверх списка')");
  await expect(page.locator("#col-new .task").first()).toContainText(title);
});

test("a notification is closed by its cross on the phone too", async ({ page }) => {
  const text = `E2E тост моб ${Date.now()}`;

  await login(page);
  await page.click('[data-tab="ideas"]');
  await page.fill("#ideaInput", text);
  await page.locator("#ideaInput").press("Enter");
  const idea = page.locator(".idea-item", { hasText: text });
  await expect(idea).toBeVisible();
  await idea.locator(".idea-del").click();

  const toast = page.locator(".toast", { hasText: "Идея удалена" });
  await expect(toast).toBeVisible();
  // A finger needs a target it can hit without looking.
  const box = await toast.locator(".close").boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(36);
  expect(box?.height).toBeGreaterThanOrEqual(36);

  await toast.locator(".close").click();
  await expect(toast).toHaveCount(0);
});
