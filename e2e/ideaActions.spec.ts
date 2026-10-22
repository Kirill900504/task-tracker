import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";

// Мысль: действия словами в одну строку с датой, «Важно» и × в углу — и
// список адресатов, который сам следит за командой (21.10.2026).
//
// Проверяется то, что можно было сломать незаметно: ряд «дата · Создать ·
// Отправить · Поделиться» переносится на вторую строку при обычной ширине
// окна (это и был бы «не помещается»), меню «Отправить» показывает
// убранного человека или не показывает добавленного без перезагрузки, а
// убранный исполнитель на задаче выглядит живым коллегой.
//
// Отдельным файлом по той же причине, что textCap.spec.ts: вход локальный.

const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
}

async function addIdea(page: Page, text: string) {
  await page.fill("#ideaInput", text);
  await page.locator("#ideaInput").press("Enter");
  const item = page.locator(".idea-item", { hasText: text });
  await expect(item).toBeVisible();
  return item;
}

test("мысль: дата и три действия словами — одной строкой на обычных ширинах", async ({ page }) => {
  await login(page);
  const item = await addIdea(page, `E2E мысль с кнопками ${Date.now()}`);
  await expect(item.locator(".idea-act", { hasText: "Создать" })).toBeVisible();
  await expect(item.locator(".idea-act", { hasText: "Отправить" })).toBeVisible();
  await expect(item.locator(".idea-act", { hasText: "Поделиться" })).toBeVisible();
  // «Завершить» — зелёная галочка в углу рядом с флажком, не словом в ряду.
  await expect(item.locator(".idea-corner .idea-check")).toBeVisible();
  await expect(item.locator(".idea-act", { hasText: "Завершить" })).toHaveCount(0);

  for (const width of [1920, 1600, 1440, 1366, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    // Строка одна, если у даты и у каждой кнопки один и тот же центр по
    // вертикали; перенос даёт разницу в целую строку.
    const rows = await item.evaluate((el) => {
      const mid = (n: Element | null) => {
        const r = n!.getBoundingClientRect();
        return Math.round(r.top + r.height / 2);
      };
      return [mid(el.querySelector(".idea-meta")), ...[...el.querySelectorAll(".idea-act")].map(mid)];
    });
    expect(Math.max(...rows) - Math.min(...rows), `ширина ${width}: ${rows.join(",")}`).toBeLessThan(6);
    if (process.env.SHOT_DIR) await item.screenshot({ path: `${process.env.SHOT_DIR}/idea-${width}.png` });
  }

  // Повторный запуск: «Отправить» и «Поделиться» стоят с первого кадра, а не
  // через секунду после «Создать» (22.10.2026, снимок Кирилла). Запрос
  // списка команды нарочно задерживается — кнопки обязаны прийти из кэша
  // прошлого запуска (lib/sharedStore, `persist`), а не из сети.
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.route(/\/rest\/v1\/assignees\?.*telegram_chat_id/, async (route) => {
    await new Promise((r) => setTimeout(r, 10_000));
    await route.continue().catch(() => {});
  });
  await page.reload();
  await expect(item).toBeVisible({ timeout: 30_000 });
  await expect(item.locator(".idea-act", { hasText: "Отправить" })).toBeVisible({ timeout: 3_000 });
  await expect(item.locator(".idea-act", { hasText: "Поделиться" })).toBeVisible({ timeout: 3_000 });
  await page.unroute(/\/rest\/v1\/assignees\?.*telegram_chat_id/);

  // Флажок говорит своё состояние: нажали — мысль важная, карточка красная.
  await item.locator(".idea-flag").click();
  await expect(item).toHaveClass(/important/);
  await expect(item.locator(".idea-flag")).toHaveAttribute("aria-pressed", "true");
  if (process.env.SHOT_DIR) await item.screenshot({ path: `${process.env.SHOT_DIR}/idea-important.png` });

  // Галочка вычёркивает мысль из рабочего списка.
  await item.locator(".idea-check").click();
  await expect(item).toHaveCount(0);
});

test("адресаты мысли следят за командой, убранный на задаче помечен «удалён»", async ({ page }) => {
  const db = admin();
  const stamp = Date.now();
  const name = `Еуклид Тестов ${stamp}`;
  const taskId = randomUUID();
  const taskTitle = `E2E задача убранного ${stamp}`;

  await login(page);
  const item = await addIdea(page, `E2E мысль адресатам ${stamp}`);
  const menuItem = () => page.locator(".export-menu, .action-sheet").first().locator(".export-item", { hasText: name });
  const openMenu = async () => {
    await page.keyboard.press("Escape");
    await item.locator(".idea-act", { hasText: "Отправить" }).click();
    await expect(page.locator(".export-menu, .action-sheet").first()).toBeVisible();
  };

  let personId = "";
  try {
    // Добавили человека — он появляется в «Кому отправить» без перезагрузки.
    const { data: added, error } = await db.from("assignees").insert({ user_id: userId, name }).select("id").single();
    expect(error).toBeNull();
    personId = (added as { id: string }).id;
    await expect(async () => {
      await openMenu();
      await expect(menuItem()).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });

    // Задача на нём — чтобы после «убрать» было где увидеть пометку.
    expect(
      (await db.from("tasks").insert({ id: taskId, user_id: userId, title: taskTitle, assignee: name, status: "in_progress", deadline: "2030-01-01" }))
        .error,
    ).toBeNull();
    await db
      .from("task_participants")
      .upsert({ user_id: userId, task_id: taskId, assignee_id: personId, role: "executor" }, { onConflict: "task_id,assignee_id", ignoreDuplicates: true });

    // Убрали — пропал из меню, тоже без перезагрузки.
    expect((await db.from("assignees").update({ archived_at: new Date().toISOString() }).eq("id", personId)).error).toBeNull();
    await expect(async () => {
      await openMenu();
      await expect(menuItem()).toHaveCount(0, { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await page.keyboard.press("Escape");

    // На задаче он остаётся — с пометкой, а не как живой коллега.
    await page.locator(".task", { hasText: taskTitle }).first().click();
    const person = page.locator(`#taskPeople .tperson[data-person="${name}"]`);
    await expect(person).toBeVisible({ timeout: 20_000 });
    await expect(person.locator(".archived-mark")).toHaveText("удалён");
    await expect(person.locator(".pbadge")).toHaveClass(/ps-archived/);
    // «Задача не дошла» рядом с «удалён» — неправда о доставке: мессенджеры
    // снимаются вместе с уходом из команды.
    await expect(person.locator(".pbadge-word")).toHaveCount(0);
    if (process.env.SHOT_DIR) await page.locator("#taskPeople").screenshot({ path: `${process.env.SHOT_DIR}/task-archived.png` });
  } finally {
    await db.from("task_participants").delete().eq("task_id", taskId);
    await db.from("tasks").delete().eq("id", taskId);
    if (personId) await db.from("assignees").delete().eq("id", personId);
  }
});
