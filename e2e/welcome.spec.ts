import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";

// Дорога нового человека в трекер (28.10.2026): одно приглашение из
// «Команды» → страница с его именем и ботами → вход на компьютере через
// бота, без пароля (lib/welcomeInvite, lib/messengerLogin).
//
// Нажать «Да, войти» в Telegram тест не может, поэтому то, что делает бот
// (кладёт в запрос одноразовый код), делается служебным ключом — а всё,
// что делает страница входа (ждёт, забирает код, входит в ЭТОМ окне),
// проверяется по-настоящему.
const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

test("приглашение из «Команды» открывает страницу с именем и ботами", async ({ page, browser }) => {
  const db = admin();
  const name = `Гость Приглашённый ${Date.now() % 100000}`;
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
  const { data: person } = await db.from("assignees").insert({ user_id: userId, name }).select("id").single();
  try {
    await page.click("#teamBtn");
    const row = page.locator(".team-row").filter({ has: page.locator(".team-name", { hasText: name }) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Пригласить", exact: true }).click();
    const message = page.locator("#inviteMessage");
    await expect(message).toContainText("/welcome/", { timeout: 20_000 });
    const link = (await message.innerText()).match(/https?:\/\/\S+\/welcome\/[A-Z0-9]{8}/)![0];

    // Страницу открывает человек без входа — отдельный браузер без куки.
    const guest = await browser.newContext();
    const gp = await guest.newPage();
    await gp.goto(link);
    await expect(gp.locator("#welcomeCard")).toContainText("Гость, добро пожаловать", { timeout: 20_000 });
    const code = link.split("/").pop()!;
    await expect(gp.locator("#welcomeTelegram")).toHaveAttribute("href", new RegExp(`t\.me/.+\?start=${code}$`));
    await expect(gp.locator("#welcomeDownload")).toHaveAttribute("href", /github\.com/);

    // Подключился (как это сделал бы «Start») — шаг отмечается сам.
    await db.from("assignees").update({ telegram_chat_id: 777000 + (Date.now() % 1000) }).eq("id", person!.id);
    await expect(gp.locator("#welcomeStepBot")).toHaveClass(/done/, { timeout: 15_000 });
    await guest.close();
  } finally {
    await db.from("telegram_link_codes").delete().eq("assignee_id", person!.id);
    await db.from("assignees").delete().eq("id", person!.id);
  }
});

test("вход через бота: окно ждёт подтверждения и входит само", async ({ browser }) => {
  const db = admin();
  const guest = await browser.newContext();
  const page = await guest.newPage();
  await page.goto("/login");
  const tg = page.locator("#messengerSignIn button", { hasText: "Войти через Telegram" });
  await expect(tg).toBeVisible({ timeout: 20_000 });
  await tg.click();
  // Запасная дорога — ссылка на бота; на компьютере она ведёт прямо в
  // приложение (tg://), а не на страницу t.me.
  const open = page.locator(".ms-signin-open");
  const href = (await open.getAttribute("href"))!;
  expect(href).toMatch(/^tg:\/\/resolve\?domain=[A-Za-z0-9_]+&start=LOGIN[A-Z0-9]{20}$/);
  const token = /start=(LOGIN[A-Z0-9]{20})/.exec(href)![1];

  // Главная дорога — запрос в чат по телефону или почте. Ответ одинаков,
  // нашёлся человек или нет, и окно начинает ждать с числом для сверки.
  await page.locator("#msWho").fill("нет-такой@example.invalid");
  await page.locator("#msPushBtn").click();
  await expect(page.locator(".ms-signin-wait")).toBeVisible();
  const { data: row } = await db.from("login_requests").select("code").eq("token", token).single();
  await expect(page.locator("#loginCode")).toHaveText(String(row!.code));

  // То, что делает бот на «✅ Да, войти».
  const { data: link } = await db.auth.admin.generateLink({ type: "magiclink", email });
  await db
    .from("login_requests")
    .update({ approved_at: new Date().toISOString(), token_hash: link.properties!.hashed_token })
    .eq("token", token);

  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
  // Код выдан один раз и забыт.
  const { data: left } = await db.from("login_requests").select("token").eq("token", token);
  expect(left || []).toHaveLength(0);
  await guest.close();
});
