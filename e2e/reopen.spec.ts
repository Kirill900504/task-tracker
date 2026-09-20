import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
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

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

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

test("принятая задача открывается заново кнопкой в карточке", async ({ page }) => {
  const title = `E2E открыть заново ${Date.now()}`;
  await login(page);

  // Задача самому себе: отчитаться и принять работу должен один человек,
  // иначе для теста понадобился бы второй вход.
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await waitForSaved(page);

  // Перезагрузка перед ответом — не украшение теста, а первый запуск
  // нового аккаунта. Список людей у него сеется движком синхронизации в
  // ту же секунду, а useWorkspaceRole ищет свою строку («(я)») ОДНИМ
  // запросом на старте: в первый заход он видит пустой список и остаётся
  // без своей строки до следующей загрузки. У живого трекера люди есть
  // всегда, поэтому это ничего не стоит там и стоит одного reload здесь.
  await page.reload();
  await expect(page.locator("#newTaskBtn")).toBeVisible();
  // Столбец «Завершённые» — это режим показа, он живёт во вкладке и
  // перезагрузку не переживает.
  await showDoneOn(page);

  // Отчитаться — из самой карточки, там же, где задача (экрана «Что от вас
  // ждут» больше нет).
  await page.locator(".task", { hasText: title }).click();
  // Строка участия заводится на сервере (триггер плюс assignExecutors) и
  // приезжает realtime-ом чуть позже самой задачи — до неё блока «Это
  // поручено вам» в карточке просто нет.
  const report = page.locator(".my-work .btn", { hasText: "Сделал" });
  await expect(report).toBeVisible({ timeout: 20_000 });
  await report.click();
  await page.fill("#myWorkDone", "Готово, проверяйте");
  await page.locator(".ms-answer-actions .btn", { hasText: "Отправить отчёт" }).click();

  // Отчитались все — появляется приёмка. Она закрывает и задачу, и окно.
  const approve = page.locator(".tp-review-actions .btn", { hasText: "Принять" });
  await expect(approve).toBeVisible({ timeout: 15_000 });
  await approve.click();
  await page.click("#askOkBtn");
  await expect(page.locator("#taskOverlay")).toHaveCount(0);
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
