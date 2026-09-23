import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { pickSelfExecutor } from "./helpers";
import { userFilePath } from "./userFile";

// Выход из «Завершённых» — весь путь, глазами человека.
//
// Доска ходит только вперёд, значит закрытую задачу возвращает ровно одна
// кнопка в карточке, и до 20.09.2026 её не было вовсе: галочка «сделано»
// снимала статус, но не приёмку, и задача оставалась в «Завершённых» —
// состояние, из которого нет выхода ни мышью, ни кнопкой.
//
// Почему отдельным файлом, а не строкой в tracker.spec.ts: Playwright
// запрещает одному файлу с тестами импортировать другой, а вход и
// ожидание сохранения живут там как локальные функции. Здесь они свои,
// короткие; общее место для них — helpers.ts, и когда tracker.spec.ts
// освободится, обе копии стоит свести туда.
//
// Проверяется именно ПОЛНЫЙ путь, а не маршрут: маршрут уже покрыт в
// test:workspace (там же и отказ чужому). Здесь важно другое — что
// человек может дойти до кнопки руками: закрытая задача открывается,
// блок приёмки показывает «Задача принята и закрыта», кнопка есть, и
// после неё задача действительно уходит из «Завершённых».

const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
  await showDoneOn(page);
}

async function showDoneOn(page: Page) {
  const btn = page.locator("#showDoneCheckbox");
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
}

async function waitForSaved(page: Page) {
  await expect(page.locator("#syncStatus")).toHaveText("✓ Сохранено", { timeout: 10_000 });
  await expect(page.locator("#syncStatus")).not.toHaveClass(/show/, { timeout: 15_000 });
}

// Дождаться, пока у свежего аккаунта появится список людей.
//
// Он не приходит вместе с трекером: база у нового пользователя пуста, и
// DEFAULT_ASSIGNEES сеет туда сам движок синхронизации — уже после первой
// загрузки. До этого момента в форме задачи нет ни одной фишки человека,
// а задача без исполнителя не сохраняется вовсе. Без явного ожидания тест
// проверял не «открыть заново», а кто быстрее — сеяние или клик, и падал
// примерно раз из шести, каждый раз в новом месте.
//
// Спрашивается база, а не экран: список виден только внутри открытой
// формы, то есть ждать его в интерфейсе — значит открывать форму и
// закрывать её ради ожидания.
async function waitForPeople(): Promise<void> {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  for (let i = 0; i < 40; i++) {
    const { data } = await admin.from("assignees").select("id").eq("user_id", userId).limit(1);
    if ((data || []).length) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Список людей у тестового аккаунта так и не появился за 20 секунд");
}

test("принятая задача открывается заново кнопкой в карточке", async ({ page }) => {
  const title = `E2E открыть заново ${Date.now()}`;
  await login(page);
  await waitForPeople();

  // Задача самому себе: отчитаться и принять работу должен один человек,
  // иначе для теста понадобился бы второй вход.
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await waitForSaved(page);

  // Отчитаться — из самой карточки, там же, где задача (экрана «Что от вас
  // ждут» больше нет).
  //
  // Перезагрузки здесь нарочно НЕТ, хотя пару часов она стояла: у нового
  // аккаунта список людей сеется в ту же секунду, и своя строка («(я)»)
  // находилась только со второй загрузки. Это чинилось в самом трекере
  // (useWorkspaceRole переспрашивает её, пока список едет), и тест
  // обязан проверять починку, а не обходить её: первый заход должен
  // сразу показывать «Это поручено вам».
  await card.click();
  // Строка участия заводится на сервере (триггер плюс assignExecutors) и
  // приезжает realtime-ом чуть позже самой задачи — до неё блока «Это
  // поручено вам» в карточке просто нет.
  const report = page.locator(".my-work .btn", { hasText: "Сделал" });
  await expect(report).toBeVisible({ timeout: 20_000 });
  await report.click();
  await page.fill("#myWorkDone", "Готово, проверяйте");
  await page.locator(".ms-answer-actions .btn", { hasText: "Отправить отчёт" }).click();

  // Отчёт отправлен — карточка закрывается сама, и задача уезжает на
  // приёмку. Кирилл 22.09.2026: «при нажатии сделал задача автоматически
  // закрывалась и улетала на проверку»; до этого окно оставалось висеть
  // над задачей, которой в этом столбце уже нет, и читалось как «а что,
  // не сработало?».
  await expect(page.locator("#overlay")).toHaveCount(0, { timeout: 15_000 });
  const onReview = page.locator("#col-review .task", { hasText: title });
  await expect(onReview).toBeVisible({ timeout: 15_000 });

  // Принимает работу постановщик, и для этого карточку открывают заново —
  // уже из «На приёмке».
  await onReview.click();
  const approve = page.locator(".tp-review-actions .btn", { hasText: "Принять" });
  await expect(approve).toBeVisible({ timeout: 15_000 });
  await approve.click();
  await page.click("#askOkBtn");
  // Приёмка тоже закрывает окно (#overlay — это id у <dialog> самой
  // карточки; прежний `#taskOverlay` не существовал в разметке вовсе, то
  // есть проверка проходила всегда и не проверяла ничего).
  await expect(page.locator("#overlay")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("#col-done .task", { hasText: title })).toBeVisible({ timeout: 15_000 });

  // И вот то, ради чего тест: из «Завершённых» есть выход.
  await page.locator("#col-done .task", { hasText: title }).click();
  const reopen = page.locator(".tp-review-actions .btn", { hasText: "Открыть заново" });
  await expect(reopen).toBeVisible();
  await reopen.click();
  await page.click("#askOkBtn");

  // Задача ушла из «Завершённых» — и ушла по-настоящему: перезагрузка
  // читает строку из базы, а не из памяти вкладки. Именно здесь ломалось
  // раньше: на экране галочка снята, а после F5 задача снова закрыта,
  // потому что приёмку браузер снять не может.
  await expect(page.locator("#col-done .task", { hasText: title })).toHaveCount(0, { timeout: 15_000 });
  await page.reload();
  await expect(page.locator(".task", { hasText: title })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#col-done .task", { hasText: title })).toHaveCount(0);
});

test("отказ тоже закрывает карточку и уводит задачу на приёмку", async ({ page }) => {
  const title = `E2E отказ ${Date.now()}`;
  await login(page);
  await waitForPeople();

  // Почему это проверяется отдельно от отчёта, хотя закрывает окно одна и
  // та же строка кода: правило здесь не «после отчёта», а «после ответа,
  // который ПЕРЕДВИНУЛ задачу», и два его случая держатся на разных
  // основаниях. Отчёт двигает задачу через allDone, отказ — через
  // allAnswered (taskProgress), то есть любая правка, вернувшая отказу
  // смысл «задача осталась в работе», разведёт столбец и окно обратно:
  // карточка стоит в «В работе», а окно висит над ней закрытым ответом.
  // Проверять это на отчёте бесполезно — он останется зелёным.
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await waitForSaved(page);

  await card.click();
  const decline = page.locator(".my-work .btn", { hasText: "Не могу" });
  await expect(decline).toBeVisible({ timeout: 20_000 });
  await decline.click();
  await page.fill("#myWorkDecline", "Нет доступа к смете");
  await page.locator(".ms-answer-actions .btn", { hasText: "Отправить" }).click();

  // Отказ — это ответ: ждут уже не исполнителя, а решения постановщика,
  // и потому задача уходит на приёмку, а карточка закрывается так же, как
  // после «Сделал».
  await expect(page.locator("#overlay")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("#col-review .task", { hasText: title })).toBeVisible({ timeout: 15_000 });
  // И не закрывается сама собой: отказ решает не за постановщика.
  await expect(page.locator("#col-done .task", { hasText: title })).toHaveCount(0);
});
