import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";
import { pickSelfExecutor } from "./helpers";

// Сторожа к тому, что нашёл полный QA-проход 06.10.2026 руками в браузере.
//
// Каждая из этих поломок жила при зелёном наборе: стрелку «Назад» никто не
// искал на компьютере (класс у неё был правильный — перебивало чужое
// правило), встречу по умолчанию никто не открывал вечером, поиск по «КП»
// никто не набирал, а «(я)» проверяли в одном месте из четырёх. Поэтому
// здесь спрашивается то, что видит человек, а не то, что лежит в разметке.

const { id: ownerId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 20_000 });
}

test("на компьютере у окна нет мобильной стрелки «Назад»", async ({ page }) => {
  await login(page);
  await page.click("#newTaskBtn");
  await expect(page.locator("#fTitle")).toBeVisible();
  // Стрелка существует в разметке каждого окна и обязана быть невидимой на
  // ПК: `button:has(> .icon)` перебивал её `display:none` специфичностью.
  await expect(page.locator("dialog[open] .modal-back-btn")).toBeHidden();
  await page.keyboard.press("Escape");
});

test("после «Название не заполнено» фокус возвращается в название", async ({ page }) => {
  await login(page);
  await page.click("#newTaskBtn");
  await page.locator("dialog[open] .modal").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.click("#saveTaskBtn");
  await page.getByRole("button", { name: "Понятно" }).click();
  await expect(page.locator("#fTitle")).toBeFocused();
  await expect(page.locator("#fTitle")).toBeInViewport();
});

test("новая встреча по умолчанию не стоит в прошлом", async ({ page }) => {
  await login(page);
  await page.keyboard.press("b");
  await expect(page.locator("#mTitle")).toBeVisible();
  const date = await page.locator("#mDate").getAttribute("data-value");
  const time = (await page.locator("#mTimeGrid .time-slot.selected").textContent())?.trim();
  expect(date, "дата встречи выбрана").toBeTruthy();
  expect(time, "время встречи выбрано").toMatch(/^\d{2}:\d{2}$/);
  const startsAt = new Date(`${date}T${time}:00`).getTime();
  // В браузере теста то же время, что и у страницы, — сравнивать можно.
  expect(startsAt).toBeGreaterThan(Date.now());
  await page.keyboard.press("Escape");
});

test("поиск находит двухбуквенное слово вроде «КП»", async ({ page }) => {
  const mark = `${Date.now()}`;
  await login(page);
  await page.fill("#ideaInput", `Отправить КП клиенту ${mark}`);
  await page.press("#ideaInput", "Enter");
  await expect(page.locator(".idea-item", { hasText: mark }).first()).toBeVisible();
  await page.click("#searchBtn");
  await page.keyboard.type("КП");
  await expect(page.locator("#searchOverlay", { hasText: mark })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("пометки «(я)» нет на экране задачи", async ({ page }) => {
  const title = `QA без я ${Date.now()}`;
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  await page.locator(".task", { hasText: title }).locator(".task-title").click();
  const card = page.locator("dialog[open]");
  await expect(card.locator("#taskFacts")).toBeVisible();
  await expect(card).not.toContainText("(я)");
  await page.keyboard.press("Escape");
});

// Равные права (06.10.2026, его слова: «у меня не должно быть преимуществ и
// привилегий, у всех равные права!»). Задача, которую владельцу поставил
// коллега, для владельца — чужая работа: он её исполнитель, а не
// постановщик. Ни удалить её, ни переписать состав, ни закрыть волевым
// решением он не может — как не может любой другой исполнитель.
test("владелец не распоряжается задачей, которую ему поставил коллега", async ({ page }) => {
  test.setTimeout(90_000);
  const title = `QA от коллеги ${Date.now()}`;
  const { data: colleague, error } = await admin.auth.admin.createUser({
    email: `e2e-colleague-${Date.now()}@example.invalid`,
    password: "E2e-" + Math.random().toString(36).slice(2) + "!Aa1",
    email_confirm: true,
  });
  if (error) throw error;
  try {
    await login(page);
    // Своя строка владельца в списке людей заводится самим трекером при
    // первом входе — ждём её, по ней база и поставит его исполнителем.
    let selfName = "";
    let selfId = "";
    await expect
      .poll(async () => {
        const { data } = await admin.from("assignees").select("id, name").eq("user_id", ownerId);
        const self = (data || []).find((r) => /\(я\)\s*$/.test(r.name as string));
        selfName = (self?.name as string) || "";
        selfId = (self?.id as string) || "";
        return selfName;
      }, { timeout: 20_000 })
      .not.toBe("");
    const taskId = `qa-${Date.now().toString(36)}`;
    const { error: insertError } = await admin.from("tasks").insert({
      id: taskId,
      user_id: ownerId,
      created_by: colleague.user.id,
      title,
      assignee: selfName,
    });
    if (insertError) throw insertError;
    // Строку «(я)» триггер 0024 не заводит нарочно — участие владельца
    // ставит само приложение. Здесь — так же, руками.
    const { error: partError } = await admin
      .from("task_participants")
      .insert({ user_id: ownerId, task_id: taskId, assignee_id: selfId, role: "executor" });
    if (partError) throw partError;

    await page.reload();
    const card = page.locator(".task", { hasText: title });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.locator(".task-title").click();
    const modal = page.locator("dialog[open]");
    await expect(modal.locator("#taskFacts")).toBeVisible();
    // Как исполнитель он отвечает — это его право, как у всех.
    await expect(modal.getByRole("button", { name: "Сделал" })).toBeVisible();
    // А распоряжаться — нет.
    await expect(modal.getByRole("button", { name: "Удалить" })).toHaveCount(0);
    await expect(modal.getByRole("button", { name: /Закрыть волевым/ })).toHaveCount(0);
    await expect(modal.getByRole("button", { name: /\+ добавить/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  } finally {
    await admin.auth.admin.deleteUser(colleague.user.id);
  }
});

// «Сделал» не уезжает из-под руки. После «Принял» кнопка исчезала, ряд
// перестраивался, и второе нажатие приходилось мимо (QA 06.10.2026).
test("после «Принял» кнопка «Сделал» остаётся на месте", async ({ page }) => {
  const title = `QA ряд ${Date.now()}`;
  await login(page);
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  await page.locator(".task", { hasText: title }).locator(".task-title").click();
  const modal = page.locator("dialog[open]");
  const done = modal.getByRole("button", { name: "Сделал" });
  await expect(done).toBeVisible({ timeout: 20_000 });
  // Дата постановки — сразу, а не после эха из базы («Дата постановки —»).
  await expect(modal.locator("#taskFacts")).toContainText(/\d{2}\.\d{2}\.\d{4}/);
  const before = await done.boundingBox();
  await modal.getByRole("button", { name: "Принял" }).click();
  await expect(modal.locator(".my-work-accepted")).toBeVisible({ timeout: 15_000 });
  const after = await done.boundingBox();
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
  await page.keyboard.press("Escape");
});