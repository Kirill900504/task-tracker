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
  await expect(page.locator("#mainCol:visible")).toBeVisible();

  // Порядок вкладок продиктован им же и повторяет расположение блоков на
  // компьютере. Проверяется целиком, а не по одной: порядок — это и есть
  // всё требование, и перепутанная пара внутри него ничем себя не выдаст.
  // «В работе» встала между «Задачами» и «Приёмкой» 23.09.2026: три
  // состояния доски были кнопками внутри одного раздела, теперь это три
  // полноценных раздела.
  const tabs = await page.locator(".mobile-tab .mobile-tab-label").allTextContents();
  expect(tabs).toEqual(["Встречи", "Задачи", "В работе", "Приёмка", "Мысли", "Сегодня"]);

  // Значки — свои, контурные: ни одного эмодзи из системного шрифта.
  await expect(page.locator(".mobile-tab .mobile-tab-icon svg")).toHaveCount(6);

  // Кнопка в шапке одна, и у неё есть лицо — «вместо кнопок Лупы и „…“
  // оставить одну кнопку с картинкой команды».
  await expect(page.locator(".mobile-header button")).toHaveCount(1);
  await expect(page.locator("#mobileSearchBtn")).toHaveCount(0);
  await page.click("#mobileMoreBtn");
  await expect(page.locator("#mobileMoreMenu")).toBeVisible();
  await expect(page.locator(".export-item", { hasText: "Команда" })).toBeVisible();
  // Поиск вернулся сюда 23.09.2026: с появлением «В работе» нижняя полоса
  // и без него стала из шести разделов, и седьмая, не переключающая
  // раздел, кнопка начала путать ряд.
  await expect(page.locator(".export-item", { hasText: "Поиск" })).toBeVisible();
  // «Загрузка» ушла из полосы над доской (там остались три кнопки, которые
  // назвал Кирилл) — но не из трекера: вопрос «к кому идти первым» задают
  // как раз не за столом. Она здесь, и только когда есть кому быть
  // загруженным.
  await expect(page.locator(".export-item", { hasText: "Загрузка" })).toHaveCount(0);
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

  // Задачи: вместо кнопки во всю ширину — «+», и ничего больше. Ни
  // «Загрузки», ни «Завершённых», ни самой кнопки «Фильтры» (сворачивать
  // стало нечего), и с 23.09.2026 — ни «Все / Мне / Я поручил»: доска сама
  // разошлась на три раздела, различать «чьё» внутри каждого уже незачем.
  await expect(page.locator("#newTaskBtn:visible")).toBeVisible();
  const addBox = await page.locator("#newTaskBtn:visible").boundingBox();
  expect(addBox!.width).toBeLessThan(80);
  expect(addBox!.height).toBeGreaterThanOrEqual(40);
  await expect(page.locator("#mobileFiltersBtn")).toHaveCount(0);
  await expect(page.locator("#loadBtn")).toHaveCount(0);
  await expect(page.locator("#showDoneCheckbox")).toHaveCount(0);
  await expect(page.locator(".view-switch")).toHaveCount(0);

  // «Просрочено» на телефоне появляется, только когда есть просроченное:
  // у свежего аккаунта его нет, а пустой значок «внимание» без слова
  // рядом — это непонятная круглая кнопка (осмотр 21.09.2026).
  await expect(page.locator("#filterOverdueBtn")).toHaveCount(0);

  // Полоса при этом обязана помещаться целиком: обрезанная кнопка у края
  // читается как сломанный интерфейс, и именно так выглядело «Просроченс».
  const bar = await page.locator(".toolbar:visible").boundingBox();
  expect(bar!.width).toBeLessThanOrEqual(390);
  const barOverflow = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".toolbar")].find((e) => (e as HTMLElement).offsetParent !== null)!;
    return el.scrollWidth - el.clientWidth;
  });
  expect(barOverflow).toBeLessThanOrEqual(1);

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
  await expect(page.locator("#newTaskBtn:visible")).toBeVisible();

  await page.click("#newTaskBtn:visible");
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
  await page.click("#newTaskBtn:visible");
  await page.fill("#fTitle", title);
  // Себе: свайп, как и галочка, закрывает задачу сразу только у своей
  // работы — у чужой он спросил бы результат (см. quickDone).
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  // Искать её надо в «Новых», и это касается любой только что заведённой
  // задачи, в том числе поставленной себе: исключения у этого столбца нет
  // (см. lib/kanban). На телефоне «Новые» — это и есть раздел «Задачи».
  await expect(page.locator('.mobile-tab[data-tab="tasks"]')).toHaveClass(/active/);
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
  await page.click("#newTaskBtn:visible");
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

// Каждое состояние доски — свой раздел (23.09.2026: «убрать кнопки «новые
// задачи», «в работе» и на приёмке и сделать три полноценных раздела»).
// Переключателя столбцов внутри раздела больше нет, и новая задача живёт
// ровно в одном из них — в «Задачах».
test("«Задачи» и «В работе» — отдельные разделы, каждый со своим столбцом", async ({ page }) => {
  const title = `E2E раздел ${Date.now()}`;

  await login(page);
  await expect(page.locator(".board-tab")).toHaveCount(0);

  await page.click("#newTaskBtn:visible");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");

  await expect(page.locator("#col-new .task:visible", { hasText: title })).toBeVisible();

  // В «В работе» новой задачи нет: она ещё не принята.
  await page.click('[data-tab="work"]');
  await expect(page.locator('.mobile-tab[data-tab="work"]')).toHaveClass(/active/);
  await expect(page.locator("#col-work .task:visible", { hasText: title })).toHaveCount(0);
});

// Окно мини-приложения настраивается там, где человек работает.
//
// Мессенджер открывает мини-приложение половинной высоты, а вертикальный
// свайп внутри него по умолчанию ЗАКРЫВАЕТ окно, а не прокручивает список.
// То есть человек листает задачи, окно уезжает вниз, и трекер «сам
// закрылся». Скрипт мессенджера подключается только внутри мини-приложения
// и только ради этого; вход от него не зависит вовсе (подпись берётся из
// фрагмента адреса).
test("в мини-приложении подключается скрипт мессенджера, а в браузере — нет", async ({ page }) => {
  // Наружу не ходим: сам факт подключения и есть предмет проверки.
  let asked = 0;
  await page.route("https://telegram.org/js/telegram-web-app.js", async (route) => {
    asked++;
    await route.fulfill({ status: 200, contentType: "application/javascript", body: "window.Telegram={WebApp:{ready(){},expand(){},disableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){}}};" });
  });

  // Обычный вход: никакого чужого скрипта на странице.
  await login(page);
  await expect(page.locator("#tg-webapp-script")).toHaveCount(0);
  expect(asked, "в обычном браузере скрипт мессенджера не должен запрашиваться").toBe(0);

  // Пришли «из мессенджера»: подпись заведомо негодная, вход не удастся —
  // но окно настроить надо в любом случае, иначе человек увидит объяснение
  // в окошке половинной высоты.
  await page.goto("/login#tgWebAppData=auth_date%3D1%26hash%3Dnope");
  // Сам тег — и есть предмет проверки: загрузился ли он к этой секунде,
  // дело асинхронное и к правилу отношения не имеет.
  await expect(page.locator("#tg-webapp-script")).toHaveCount(1, { timeout: 15_000 });
});

// «Принял» — из списка, не открывая карточку.
//
// Это единственный ответ исполнителя, которому не нужны слова: «вижу,
// взял». Остальные — «Сделал», «Не могу», «Прошу перенос» — требуют
// комментария и потому открывают карточку. Ради «Принял» открывать форму,
// листать её и закрывать — три действия вместо одного, и на телефоне
// именно этот путь длиннее всего.
test("«Принял» есть в меню карточки и не требует открывать её", async ({ page }) => {
  const title = `E2E принял ${Date.now()}`;

  await login(page);
  // Люди приезжают в базу первой же синхронизацией, а не вместе с входом:
  // у свежего аккаунта список подставляется в состояние и только потом
  // уходит строками в базу, откуда его читает форма. Открытая раньше
  // этого момента форма показывает одно «+ человек», и тест падает на
  // выборе исполнителя — причём на боевом чаще, чем на локальной сборке.
  await expect(page.locator("#syncStatus")).toContainText("Сохранено", { timeout: 40_000 });

  await page.click("#newTaskBtn:visible");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");

  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  // Участие доезжает ОТДЕЛЬНОЙ строкой, и до неё меню о роли ничего не
  // знает — пункта в нём просто нет. Ждём не время, а признак: карточка
  // красится в цвет своей роли ровно тогда, когда строка участия дошла.
  await expect(card).toHaveClass(/role-executor/, { timeout: 20_000 });

  await card.locator("[data-task-menu]").click();
  await page.click(".action-sheet .export-item:has-text('Принял в работу')");
  await expect(page.locator(".toast", { hasText: "Взяли в работу" })).toBeVisible({ timeout: 15_000 });

  // Принято — значит второй раз предлагать нечего. Искать карточку надо
  // уже в разделе «В работе»: принятая задача туда и уезжает.
  await expect(page.locator(".modal")).toHaveCount(0);
  await page.click('[data-tab="work"]');
  const inWork = page.locator("#col-work .task", { hasText: title });
  await expect(inWork).toBeVisible({ timeout: 15_000 });
  await inWork.locator("[data-task-menu]").click();
  await expect(page.locator(".action-sheet .export-item", { hasText: "Принял в работу" })).toHaveCount(0);
});

// Листание разделов пальцем.
//
// Жест просили прямо (22.09.2026), и опасность у него ровно одна: на этом
// же экране горизонталь уже занята — по карточке задачи свайп закрывает её
// или открывает действия, полосы фильтров и столбцов прокручиваются вбок.
// Поэтому проверяется и то, что жест работает, и то, что он НЕ работает
// там, где занято.
test("свайп по содержимому листает разделы, но не там, где горизонталь занята", async ({ page }) => {
  await login(page);
  await expect(page.locator('.mobile-tab[data-tab="tasks"]')).toHaveClass(/active/);

  // Playwright не умеет жестов — события шлются напрямую, теми же
  // координатами, какими их прислал бы палец. И это КАСАНИЯ, а не
  // pointer-события: на настоящем телефоне браузер забирает поехавший палец
  // под прокрутку и вместо pointerup шлёт pointercancel, поэтому раздел
  // слушает touchstart/touchend (MobileShell, 24.09.2026). Тест на
  // pointer-событиях проходил, пока на iPhone жест не работал вовсе.
  const swipe = (selector: string, dx: number) =>
    page.evaluate(
      ({ selector, dx }) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error("не найдено: " + selector);
        const r = el.getBoundingClientRect();
        const y = Math.round(r.top + Math.min(40, r.height / 2));
        const x = Math.round(r.left + r.width / 2);
        const t = (cx: number) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
        el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [t(x)], changedTouches: [t(x)] }));
        el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [t(x + dx / 2)], changedTouches: [t(x + dx / 2)] }));
        el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [t(x + dx)] }));
      },
      { selector, dx },
    );

  // Влево — следующий раздел по полосе: «Задачи» → «В работе».
  await swipe("#mobileMain", -140);
  await expect(page.locator('.mobile-tab[data-tab="work"]')).toHaveClass(/active/, { timeout: 5000 });

  // Вправо — обратно.
  await swipe("#mobileMain", 140);
  await expect(page.locator('.mobile-tab[data-tab="tasks"]')).toHaveClass(/active/, { timeout: 5000 });

  // А по полосе над доской — ничего: у неё своя горизонталь, и
  // переключать разделы оттуда значит отнимать у неё жест.
  await swipe('#mobileMain > div:not([hidden]) .toolbar', -140);
  await page.waitForTimeout(600);
  await expect(page.locator('.mobile-tab[data-tab="tasks"]')).toHaveClass(/active/);
});

// Поиск — снова в меню шапки (23.09.2026): с разделом «В работе» нижняя
// полоса и без него из шести кнопок.
test("поиск открывается из меню шапки, а в нижней панели его нет", async ({ page }) => {
  await login(page);

  await expect(page.locator("#mobileSearchTab")).toHaveCount(0);
  await page.click("#mobileMoreBtn");
  await page.locator(".export-item", { hasText: "Поиск" }).click();
  await expect(page.locator("#searchOverlay")).toBeVisible();
});

// Вход по ссылке из мессенджера.
//
// Страница обязана быть публичной: человек приходит сюда ИМЕННО потому,
// что сессии у него нет. Отправить его на /login значит показать форму
// входа тому, кто в эту секунду входит.
test("страница входа по ссылке открыта без сессии", async ({ browser }) => {
  const fresh = await browser.newContext();
  const page = await fresh.newPage();
  // Без токена — это или вторая попытка открыть сгоревшую ссылку, или
  // набранный руками адрес: обе кончаются формой входа, а не пустотой.
  await page.goto("/enter");
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.locator("#email")).toBeVisible();
  await fresh.close();
});

// Плохая связь — не то же самое, что её отсутствие.
//
// Офлайн проверялся и раньше, но только целиком выключенный: сеть есть или
// её нет. У человека в поле третье состояние, и оно самое неприятное —
// запрос ушёл и не вернулся. Трекер обязан в эти секунды показывать
// сохранённую копию и говорить, что связи нет, а не пустой экран с
// крутилкой.
test("на медленной связи трекер открывается из копии, а не ждёт сеть", async ({ page, context }) => {
  test.setTimeout(180_000);
  await login(page);
  // Дождаться, пока копия успеет сохраниться: без неё проверять нечего.
  await expect(page.locator("#syncStatus")).toContainText("Сохранено", { timeout: 40_000 });

  // Запросы к базе уходят и не возвращаются — ровно то, что делает
  // мобильный интернет в подвале. Не обрыв: соединение установлено,
  // ответа нет.
  await context.route("**/rest/v1/**", async () => {
    // Молчим: маршрут не отвечает вовсе.
  });
  await context.route("**/sb/rest/v1/**", async () => {});

  await page.reload();

  // Трекер всё равно открывается — из локальной копии, первым кадром.
  await expect(page.locator("#mobileNav")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#newTaskBtn:visible")).toBeVisible({ timeout: 30_000 });
  // И говорит, что показывает сохранённое, а не делает вид, что всё в
  // порядке: молчаливая копия — это данные, которым доверяют зря. Значок
  // в шапке (ConnectionStatus.tsx), а не баннер на пол-экрана.
  await expect(page.locator("#connOfflineBtn")).toBeVisible({ timeout: 60_000 });

  await context.unroute("**/rest/v1/**");
  await context.unroute("**/sb/rest/v1/**");
});

// Свайп влево по карточке — то же меню, что у «⋮».
//
// Правая сторона занята («готово»), левая была свободна, и ею закрывается
// самый длинный путь на телефоне: найти задачу, попасть пальцем в точку
// размером с горошину у края карточки, выбрать действие.
test("свайп влево по карточке открывает её действия", async ({ page }) => {
  const title = `E2E жест ${Date.now()}`;

  await login(page);
  await expect(page.locator("#syncStatus")).toContainText("Сохранено", { timeout: 40_000 });
  await page.click("#newTaskBtn:visible");
  await page.fill("#fTitle", title);
  await pickAnyExecutor(page);
  await page.click("#saveTaskBtn");

  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await expect(card).not.toHaveClass(/just-created/, { timeout: 10_000 });
  await page.waitForTimeout(1000);

  await page.evaluate((taskTitle) => {
    const el = [...document.querySelectorAll(".task")].find((t) => t.textContent?.includes(taskTitle));
    if (!el) throw new Error("карточка не найдена");
    const r = el.getBoundingClientRect();
    const y = Math.round(r.top + 20);
    const x = Math.round(r.right - 40);
    const base = { pointerType: "touch", bubbles: true, isPrimary: true, pointerId: 1, clientY: y };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...base, clientX: x }));
    el.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: x - 50 }));
    el.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: x - 130 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: x - 130 }));
  }, title);

  // То самое меню: полоса у нижнего края, с теми же действиями.
  await expect(page.locator(".action-sheet")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".action-sheet .export-item", { hasText: "Наверх списка" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".action-sheet")).toHaveCount(0);
});
