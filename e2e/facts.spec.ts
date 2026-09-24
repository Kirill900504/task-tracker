import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";
import { pickSelfExecutor } from "./helpers";

// Сводка задачи, блок «Результат» и переписка — то, что Кирилл просил
// 21.09.2026 первыми двумя пунктами и чего не проверял ни один тест.
//
// Проверяется здесь не разметка ради разметки. Каждая из трёх вещей
// отвечает на вопрос, который до неё в карточке оставался без ответа:
// «кто это поручил и когда» (постановщика не было видно нигде, кроме
// подписи на кубике), «что именно сдали» (отчёт лежал строкой между ролью
// и кнопкой «убрать») и «кто это написал» (реплики стояли ровным столбцом
// одинаковых карточек). Разъехаться это может молча: разметка живёт, а
// данные в неё не доходят — ровно так `.meeting-facts` пережил свой
// компонент и остался мёртвым правилом в стилях.

const { email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

// Свой аккаунт на прогон — как и у остальных наборов; служебный клиент нужен
// только чтобы не зависеть от порядка тестов.
createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

test("карточка задачи говорит, кто поручил, кому и к какому сроку", async ({ page }) => {
  const title = `E2E сводка ${Date.now()}`;

  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });

  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  // Задача самому себе: тесту важна сводка, а не путь работы между двумя
  // людьми, и отчитаться по своей задаче можно тут же.
  await pickSelfExecutor(page);
  // Срок — кнопкой «Завтра», ею же проверяется, что быстрые кнопки живы.
  await page.locator(".deadline-row .participant-chip", { hasText: "Завтра" }).first().click();
  await page.click("#saveTaskBtn");

  const card = page.locator(`.task:has-text("${title}")`).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  // На кубике — «кто поручил → кому» и срок со словом «до».
  await expect(card.locator(".task-who")).toBeVisible();
  await expect(card.locator(".task-due")).toContainText(/до |сегодня|просрочено/);

  await card.click();
  const facts = page.locator("#taskFacts");
  await expect(facts).toBeVisible();
  await expect(facts).toContainText("Постановщик");
  await expect(facts).toContainText("Дата постановки");
  await expect(facts).toContainText("Крайний срок");
  // Дата постановки берётся из created_at строки задачи: пусто здесь
  // значило бы, что колонка не доехала до типа (так и было до 0039-го
  // круга правок — поля createdAt в Task не существовало вовсе).
  await expect(facts).toContainText(/\d{2}\.\d{2}\.\d{4}/);

  // Отчёт исполнителя попадает в блок «Результат» — с именем и временем.
  await page.locator(".my-work .btn", { hasText: "Сделал" }).click();
  await page.fill("#myWorkDone", "Готово, проверьте");
  await page.locator(".ms-answer-actions .btn", { hasText: "Отправить отчёт" }).click();
  // Окно закрывается само: отчёт — это итоговый результат исполнителя, и
  // висеть над ним карточке незачем (пункт 10 Кирилла).
  await expect(page.locator("#overlay")).toHaveCount(0, { timeout: 20_000 });

  await page.locator(`.task:has-text("${title}")`).first().click();
  const results = page.locator("#taskResults");
  await expect(results).toBeVisible({ timeout: 20_000 });
  await expect(results).toContainText("Готово, проверьте");
  await expect(results.locator(".result-when")).toContainText(/\d{2}\.\d{2}\.\d{4}/);

  // Статус — в правом верхнем углу сводки, вровень с «Постановщиком», а
  // не отдельной строкой (24.09.2026: «убрать лишний отступ, который
  // образуется за счёт того, что статус отдельной строкой показывается»).
  const stage = facts.locator(".facts-row.has-badge .tp-stage");
  await expect(stage).toContainText("на приёмке");
  await expect(facts.locator(".facts-badge-row")).toHaveCount(0);
  const author = facts.locator(".fact-label", { hasText: "Постановщик" });
  const [stageBox, authorBox, factsBox] = [await stage.boundingBox(), await author.boundingBox(), await facts.boundingBox()];
  expect(Math.abs(stageBox!.y - authorBox!.y)).toBeLessThan(14);
  expect(stageBox!.x + stageBox!.width).toBeGreaterThan(factsBox!.x + factsBox!.width * 0.7);

  // И решение постановщика — сразу под описанием, ВЫШЕ сводки: ради него
  // карточку на этой стадии и открывают (24.09.2026).
  const decisions = page.locator("#taskDecisions");
  await expect(decisions).toContainText("Принимаете работу?");
  expect((await decisions.boundingBox())!.y).toBeLessThan(factsBox!.y);
});

test("обсуждение выглядит перепиской: своя реплика справа, с временем", async ({ page }) => {
  const title = `E2E чат ${Date.now()}`;

  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });

  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  await page.locator(`.task:has-text("${title}")`).first().click();

  const composer = page.locator(".chat-composer textarea");
  await expect(composer).toBeVisible();
  await composer.fill("Первое сообщение");
  // Enter отправляет — правило «любые заполнения закрываются Enter'ом»
  // относится и к обсуждению.
  await composer.press("Enter");

  // `:not(.sending)` обязателен. Сообщение появляется в ленте до того, как
  // о нём узнает база (местная копия, класс `sending`), а подтверждённая
  // строка может приехать подпиской раньше, чем отправка успеет убрать
  // копию, — тогда в ленте на долю секунды живут оба пузыря. Человек этого
  // не замечает, а строгий поиск Playwright спотыкается: «resolved to 2
  // elements». Ждём именно подтверждённый.
  const mine = page.locator(".chat-row.mine .chat-msg:not(.sending)").filter({ hasText: "Первое сообщение" });
  await expect(mine).toBeVisible({ timeout: 20_000 });
  // Время стоит в самом пузыре, а не строкой над ним.
  await expect(mine.locator(".chat-time")).toContainText(/\d{2}:\d{2}/);
  // Лента — со своей прокруткой: без неё разговор растягивает окно задачи.
  await expect(page.locator(".chat-feed")).toBeVisible();
});
