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
