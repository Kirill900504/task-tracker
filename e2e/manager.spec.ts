import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";



// Экран руководителя — в браузере, а не в скрипте.
//
// `npm run test:workspace` проходит весь многопользовательский сценарий
// маршрутами, но ни разу не открывает страницу; а жалоба, ради которой этот
// файл появился, была именно про страницу: Евгений Макаров подключил MAX,
// нажал «Готово, проверить» и написал «не работает кнопка». Кнопка работала —
// проверка честно перечитывала строку, находила подключение и НИЧЕГО не
// меняла на экране: блок с кодом висел, как висел. С точки зрения нажавшего
// это ровно то же самое, что мёртвая кнопка.
//
// И владелец, и руководитель заводятся здесь свои, служебным ключом.
// Общий одноразовый владелец из e2e/global-setup.ts для этого не годится, и
// это выяснилось дорого: список исполнителей заводится при первом входе
// ТОЛЬКО если он пуст, так что человек, подложенный туда заранее, отменяет
// весь список по умолчанию — и три чужих теста перестают находить Игоря
// Витковского. Своё пространство ни с кем не делится и в конце удаляется.

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const owner = { id: "" };
const manager = {
  email: `e2e-mgr-${Date.now()}@example.invalid`,
  password: "E2e-" + randomUUID().slice(0, 12) + "!Aa1",
  id: "",
  assigneeId: "",
};

test.beforeAll(async () => {
  const { data: ownerUser, error: ownerError } = await admin.auth.admin.createUser({
    email: `e2e-owner-${Date.now()}@example.invalid`,
    password: "E2e-" + randomUUID().slice(0, 12) + "!Aa1",
    email_confirm: true,
  });
  if (ownerError) throw ownerError;
  owner.id = ownerUser.user.id;

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email: manager.email,
    password: manager.password,
    email_confirm: true,
  });
  if (userError) throw userError;
  manager.id = user.user.id;

  const { data: person, error: personError } = await admin
    .from("assignees")
    .insert({ user_id: owner.id, name: "Тест Руководитель" })
    .select("id")
    .single();
  if (personError) throw personError;
  manager.assigneeId = person.id as string;

  const { error: memberError } = await admin.from("workspace_members").insert({
    owner_id: owner.id,
    member_id: manager.id,
    assignee_id: manager.assigneeId,
    role: "manager",
    status: "active",
    joined_at: new Date().toISOString(),
  });
  if (memberError) throw memberError;
});

test.afterAll(async () => {
  // Обе учётные записи — за собой; строки уезжают с владельцем по каскаду.
  if (manager.id) await admin.auth.admin.deleteUser(manager.id).catch(() => {});
  if (owner.id) await admin.auth.admin.deleteUser(owner.id).catch(() => {});
});

test("«Готово, проверить» отвечает — и когда подключения ещё нет, и когда оно появилось", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", manager.email);
  await page.fill("#password", manager.password);
  await page.click('button[type="submit"]');

  // Руководитель видит ТОТ ЖЕ трекер, что и владелец. Отдельного экрана
  // «Что от вас ждут» над ним больше нет — всё, чего ждут, стоит в самих
  // задачах и встречах. Полоса подключения мессенджера остаётся, пока он
  // не подключён: без неё задачи приходят только сюда.
  await expect(page.locator(".ms-link")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#newTaskBtn")).toHaveCount(1);

  // А админского у него нет: «Команда» — владельцева, и база отказала бы
  // ему в ней всё равно (миграции 0019 и 0031).
  await expect(page.locator("#teamBtn")).toHaveCount(0);
  // Строки разделов у него нет вовсе — 21.09.2026, слова Кирилла: «эту
  // строку убери у остальных пользователей, кроме меня, она для них не
  // информативна». Раньше он видел её без «+» и без шестерёнки, то есть
  // одиннадцать кнопок отбора там, где у него четыре задачи.
  await expect(page.locator("#sectionTabs")).toHaveCount(0);
  await expect(page.locator("#addSectionTabBtn")).toHaveCount(0);
  // И окна «Разделы» у него нет: ответственные за раздел — структура
  // пространства, её меняет владелец или тот, кому он дал права
  // (миграция 0036).
  await expect(page.locator("#sectionSettingsBtn")).toHaveCount(0);
  // Кнопок привязки чата к учётной записи у него тоже нет: его чат живёт
  // в строке человека, и подключается он полосой выше.
  await expect(page.locator("#telegramLinkBtn")).toHaveCount(0);

  // Код выдаётся на собственную строку — это и есть «подключить себе бота».
  await page.getByRole("button", { name: "Подключить Telegram" }).click();
  const code = page.locator(".ms-link-code");
  await expect(code).toBeVisible({ timeout: 20_000 });
  await expect(code.locator(".ms-link-value")).toHaveText(/^[A-Z2-9]{8}$/);

  // Нажатие до подключения обязано сказать, что проверка была и что она
  // ничего не нашла. Раньше здесь не менялось ровно ничего.
  await code.getByRole("button", { name: "Готово, проверить" }).click();
  await expect(code.locator(".ms-link-notyet")).toBeVisible({ timeout: 20_000 });

  // А теперь чат привязан — так, как это сделал бы бот после «Начать».
  const chatId = 970000000 + (Date.now() % 1000000);
  const { error } = await admin
    .from("assignees")
    .update({ telegram_chat_id: chatId, telegram_username: "e2e_manager", linked_at: new Date().toISOString() })
    .eq("id", manager.assigneeId);
  expect(error).toBeNull();

  // …и то же самое нажатие убирает полосу целиком: подключено — значит
  // спрашивать больше не о чем, и место возвращается работе. Раньше на
  // её месте оставалась строка «✓ Telegram», но она стояла на экране,
  // который открывали ради задач, и говорила то, что уже не новость.
  await code.getByRole("button", { name: "Готово, проверить" }).click();
  await expect(page.locator(".ms-link")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator("#newTaskBtn")).toBeVisible();
});
