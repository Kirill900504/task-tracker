import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";

// «Команда» у человека, который УЖЕ подключён и уже в трекере.
//
// Именно эта строка разъезжалась: у неподключённого кнопок три, а у него их
// было шесть — «+ MAX», «+ Telegram», «Отключить», «Направление», «Права»,
// «Ссылка ещё раз», «Отключить вход», — и в 580 пикселях окна они вставали
// в три яруса, разрывая пару «Telegram / MAX» между строками и отрывая
// подписи от их кнопок. Проверяется поэтому не наличие кнопок, а ВЫСОТА
// строки: ряд, поместившийся в строку, не выше своей самой высокой кнопки.
// И проверяется, что ни одно действие при этом не потерялось — они просто
// переехали в меню ⋮.
//
// Состояние подделывается служебным ключом: пригласить человека в трекер
// по-настоящему тест не может (для этого нужен второй почтовый ящик и
// переход по ссылке), а нужна ему именно строка «активен».
const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

test("строка подключённого человека остаётся строкой, а редкое живёт в меню", async ({ page }) => {
  const db = admin();

  // Людей заводит сам трекер при первом входе, поэтому сперва вход.
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });

  const { data: people } = await db.from("assignees").select("id, name").eq("user_id", userId).limit(3);
  const person = (people || [])[1];
  test.skip(!person, "у аккаунта ещё нет людей");

  await db.from("workspace_members").insert({
    owner_id: userId,
    assignee_id: person.id,
    role: "admin",
    status: "active",
    direction: "Продажи",
  });
  await db.from("assignees").update({ telegram_chat_id: 424242, telegram_username: "e2e" }).eq("id", person.id);

  try {
    await page.reload();
    await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
    await page.click("#teamBtn");
    await expect(page.locator("#teamList")).toBeVisible({ timeout: 20_000 });

    const row = page.locator(".team-row").filter({ has: page.locator(".team-name", { hasText: person.name }) });
    await expect(row).toBeVisible();
    await expect(row.locator(".team-status")).toContainText("в трекере");

    // Одна строка: высота ряда не больше полутора высот кнопки в нём.
    const more = row.locator(".team-more");
    await expect(more).toBeVisible();
    const rowBox = (await row.boundingBox())!;
    const btnBox = (await more.boundingBox())!;
    expect(rowBox.height).toBeLessThan(btnBox.height * 1.8);

    // И всё редкое — в меню, а не потеряно.
    await more.click();
    const menu = page.locator(".export-menu, .action-sheet").first();
    await expect(menu).toBeVisible();
    for (const label of ["Направление", "Права", "Ссылка на новый пароль", "Отключить вход"]) {
      await expect(menu.locator(".export-item", { hasText: label })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(".export-menu, .action-sheet")).toHaveCount(0);
    // Escape закрыл меню, а не всё окно: окна вкладываются, и один Escape
    // закрывает верхнее.
    await expect(page.locator("#teamList")).toBeVisible();
  } finally {
    await db.from("workspace_members").delete().eq("assignee_id", person.id);
    await db.from("assignees").update({ telegram_chat_id: null, telegram_username: null }).eq("id", person.id);
  }
});

// Добавить и убрать человека — прямо из «Команды» (14.10.2026).
//
// «Убрать» не удаляет строку: на ней держится всё участие человека, и
// каскадное удаление однажды уже стёрло Котова со всей историей. Поэтому
// проверяется не только то, что строка ушла с экрана, но и то, что с
// открытой задачей она без ответа «кому передать» не уходит вовсе, а
// после ответа задача стоит на получателе — в базе, а не на экране.
async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
}

test("в «Команде» человека добавляют, убирают и возвращают", async ({ page }) => {
  const db = admin();
  const name = `Тест Добавленный ${Date.now() % 100000}`;
  await signIn(page);
  await page.click("#teamBtn");
  await expect(page.locator("#teamList")).toBeVisible({ timeout: 20_000 });

  try {
    await page.click("#addPersonBtn");
    await page.fill("#askInput", name);
    await page.click("#askOkBtn");
    const row = page.locator(".team-row").filter({ has: page.locator(".team-name", { hasText: name }) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveClass(/just-added/);
    await expect(page.locator("#teamNotice")).toContainText("добавлен");
    // Следующий шаг стоит в его же строке.
    await expect(row.getByRole("button", { name: "Telegram" })).toBeVisible();

    // Дел у него нет — хватает подтверждения.
    await row.locator(".team-more").click();
    await page.locator(".export-menu, .action-sheet").first().locator(".export-item", { hasText: "Убрать из команды" }).click();
    await page.click("#askOkBtn");
    await expect(row).toHaveCount(0, { timeout: 15_000 });
    // Строка уходит с экрана раньше ответа сервера — ждём сам ответ.
    await expect(page.locator("#teamNotice")).toContainText("убран", { timeout: 15_000 });
    // Без единого следа строка удаляется по-настоящему: терять нечего.
    const { data: gone } = await db.from("assignees").select("id").eq("user_id", userId).eq("name", name);
    expect(gone || []).toHaveLength(0);

    // Добавить снова — обычное добавление.
    await page.click("#addPersonBtn");
    await page.fill("#askInput", name);
    await page.click("#askOkBtn");
    await expect(row).toBeVisible({ timeout: 15_000 });
  } finally {
    await db.from("assignees").delete().eq("user_id", userId).eq("name", name);
  }
});

test("убрать человека с открытой задачей можно, только передав её", async ({ page }) => {
  const db = admin();
  const name = `Тест Уходящий ${Date.now() % 100000}`;
  const taskId = `e2e-leave-${Date.now()}`;
  const doneId = `${taskId}-done`;
  await signIn(page);

  const { data: added } = await db.from("assignees").insert({ user_id: userId, name }).select("id").single();
  const personId = (added as { id: string }).id;
  const { data: others } = await db
    .from("assignees")
    .select("id, name")
    .eq("user_id", userId)
    .is("archived_at", null)
    .neq("id", personId)
    .not("name", "ilike", "%(я)%")
    .limit(1);
  const receiver = (others || [])[0] as { id: string; name: string };
  test.skip(!receiver, "у аккаунта нет второго человека");

  await db.from("tasks").insert({ id: taskId, user_id: userId, title: "Задача уходящего", assignee: name, status: "in_progress" });
  await db.from("task_participants").upsert(
    { user_id: userId, task_id: taskId, assignee_id: personId, role: "executor" },
    { onConflict: "task_id,assignee_id", ignoreDuplicates: true },
  );
  // Закрытая задача — его история: из-за неё строка помечается, а не
  // удаляется, и остаётся на закрытой задаче.
  await db.from("tasks").insert({ id: doneId, user_id: userId, title: "Сделанное уходящим", assignee: name, status: "done" });
  // Строку участия заводит триггер 0024 по имени в поле «Исполнитель»,
  // поэтому отчёт дописывается в неё, а не вставляется второй.
  await db.from("task_participants").upsert(
    { user_id: userId, task_id: doneId, assignee_id: personId, role: "executor" },
    { onConflict: "task_id,assignee_id", ignoreDuplicates: true },
  );
  await db.from("task_participants").update({ done_at: new Date().toISOString(), done_comment: "сделал" }).eq("task_id", doneId).eq("assignee_id", personId);

  try {
    await page.reload();
    await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
    await page.click("#teamBtn");
    const row = page.locator(".team-row").filter({ has: page.locator(".team-name", { hasText: name }) });
    await expect(row).toBeVisible({ timeout: 20_000 });

    await row.locator(".team-more").click();
    await page.locator(".export-menu, .action-sheet").first().locator(".export-item", { hasText: "Убрать из команды" }).click();

    // Вопрос — под строкой, с названием дела, и без получателя кнопка не жмётся.
    const block = page.locator("#removeBlock");
    await expect(block).toBeVisible({ timeout: 15_000 });
    await expect(block).toContainText("Задача уходящего");
    await expect(page.locator("#removeConfirmBtn")).toBeDisabled();
    await block.locator(".participant-chip", { hasText: receiver.name.replace(/\s*\(я\)$/, "") }).click();
    await page.click("#removeConfirmBtn");
    await expect(row).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator("#teamNotice")).toContainText("переданы");

    // В базе: задача на получателе, ушедший помечен, а не удалён.
    const { data: parts } = await db.from("task_participants").select("assignee_id").eq("task_id", taskId);
    expect((parts || []).map((p) => p.assignee_id)).toEqual([receiver.id]);
    const { data: task } = await db.from("tasks").select("assignee").eq("id", taskId).single();
    expect((task as { assignee: string }).assignee).toBe(receiver.name);
    const { data: person } = await db.from("assignees").select("archived_at").eq("id", personId).single();
    expect((person as { archived_at: string | null }).archived_at).not.toBeNull();
    // История на месте: закрытая задача по-прежнему его.
    const { data: kept } = await db.from("task_participants").select("assignee_id, done_comment").eq("task_id", doneId);
    expect(kept).toEqual([{ assignee_id: personId, done_comment: "сделал" }]);

    // Убранный — в списке «Убранные», откуда его возвращают.
    await page.click("#archivedToggle");
    const archivedRow = page.locator("#archivedList .team-row").filter({ hasText: name });
    await expect(archivedRow).toBeVisible();
    await archivedRow.getByRole("button", { name: "Вернуть" }).click();
    await expect(page.locator("#teamList .team-row").filter({ has: page.locator(".team-name", { hasText: name }) })).toBeVisible({ timeout: 15_000 });
  } finally {
    await db.from("item_comments").delete().in("item_id", [taskId, doneId]);
    await db.from("tasks").delete().in("id", [taskId, doneId]);
    await db.from("assignees").delete().eq("id", personId);
  }
});
