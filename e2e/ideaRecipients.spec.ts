import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Присланная мысль — в самом трекере, и кому ушла своя (07.10.2026).
//
// Кирилл: «у получателя, помимо приёмки чужих мыслей в мессенджерах, должна
// так же быть какой-то формат приёмки в приложении» и «оставлять при
// наведении мыши список, кому ранее была отправлена эта мысль». Плюс то, с
// чего его сообщение началось: «я просил ВЕЗДЕ убрать это (я)». Поэтому
// владелец здесь заведён с пометкой в имени, и тест проверяет, что на
// экране её нет.
//
// Своё пространство, служебным ключом — по той же причине, что в
// manager.spec.ts: общий одноразовый владелец делится списком людей со
// всеми тестами.

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const owner = { id: "", assigneeId: "" };
const manager = {
  email: `e2e-mgr-ideas-${Date.now()}@example.invalid`,
  password: "E2e-" + randomUUID().slice(0, 12) + "!Aa1",
  id: "",
  assigneeId: "",
};
let annaId = "";
const incomingId = "idea_e2e_in_" + randomUUID().slice(0, 8);
const sentId = "idea_e2e_out_" + randomUUID().slice(0, 8);
const keepId = "idea_e2e_keep_" + randomUUID().slice(0, 8);
const awayId = "idea_e2e_away_" + randomUUID().slice(0, 8);
const sharedInId = "idea_e2e_shin_" + randomUUID().slice(0, 8);

test.beforeAll(async () => {
  const { data: ownerUser, error: ownerError } = await admin.auth.admin.createUser({
    email: `e2e-owner-ideas-${Date.now()}@example.invalid`,
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

  const { data: people, error: peopleError } = await admin
    .from("assignees")
    .insert([
      { user_id: owner.id, name: "Кирилл Тестов (я)" },
      { user_id: owner.id, name: "Тест Руководитель" },
      { user_id: owner.id, name: "Анна Проверкина" },
    ])
    .select("id, name");
  if (peopleError) throw peopleError;
  const idOf = (name: string) => (people || []).find((p) => p.name === name)!.id as string;
  owner.assigneeId = idOf("Кирилл Тестов (я)");
  manager.assigneeId = idOf("Тест Руководитель");
  annaId = idOf("Анна Проверкина");

  const { error: memberError } = await admin.from("workspace_members").insert({
    owner_id: owner.id,
    member_id: manager.id,
    assignee_id: manager.assigneeId,
    role: "manager",
    status: "active",
    joined_at: new Date().toISOString(),
  });
  if (memberError) throw memberError;

  // Владелец ОТПРАВИЛ руководителю две мысли и ПОДЕЛИЛСЯ третьей.
  // Руководитель поделился своей с владельцем и Анной (Анна уже убрала её
  // у себя) и отправил ещё одну владельцу — та ушла из его списка.
  const { error: ideasError } = await admin.from("ideas").insert([
    { id: incomingId, user_id: owner.id, text: "Позвонить в налоговую до пятницы", created_by: null },
    { id: sentId, user_id: owner.id, text: "Обновить прайс на кассы", created_by: manager.id },
    { id: keepId, user_id: owner.id, text: "Книга про переговоры — прочитать", created_by: null },
    { id: awayId, user_id: owner.id, text: "Договор аренды — продлить", created_by: manager.id },
    { id: sharedInId, user_id: owner.id, text: "Идея акции к Новому году", created_by: null },
  ]);
  if (ideasError) throw ideasError;
  const { error: recError } = await admin.from("idea_recipients").insert([
    { user_id: owner.id, idea_id: incomingId, assignee_id: manager.assigneeId },
    { user_id: owner.id, idea_id: keepId, assignee_id: manager.assigneeId },
    { user_id: owner.id, idea_id: sentId, assignee_id: owner.assigneeId, kind: "share", seen_at: null },
    { user_id: owner.id, idea_id: sentId, assignee_id: annaId, kind: "share", seen_at: new Date().toISOString() },
    { user_id: owner.id, idea_id: awayId, assignee_id: owner.assigneeId, kind: "send", seen_at: null },
    { user_id: owner.id, idea_id: sharedInId, assignee_id: manager.assigneeId, kind: "share", seen_at: null },
  ].map((r) => ({ kind: "send", seen_at: null, ...r })));
  if (recError) throw recError;
});

test.afterAll(async () => {
  if (manager.id) await admin.auth.admin.deleteUser(manager.id).catch(() => {});
  if (owner.id) await admin.auth.admin.deleteUser(owner.id).catch(() => {});
});

test("присланную мысль принимают в трекере, а у своей видно, кому она ушла", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", manager.email);
  await page.fill("#password", manager.password);
  await page.click('button[type="submit"]');

  // «Прислали вам»: кто прислал — именем, без пометки «(я)».
  const block = page.locator("#incomingIdeas");
  await expect(block).toBeVisible({ timeout: 25_000 });
  const incoming = block.locator(`[data-incoming-idea="${incomingId}"]`);
  await expect(incoming).toContainText("Позвонить в налоговую до пятницы");
  await expect(incoming).toContainText("от Кирилл Тестов");
  await expect(incoming).not.toContainText("(я)");

  // Поделённая со мной — в списке мыслей, с подписью, от кого, а не в
  // блоке, где ждут ответа.
  const sharedIn = page.locator(`#ideaList [data-shared-idea="${sharedInId}"]`);
  await expect(sharedIn).toContainText("Идея акции к Новому году");
  await expect(sharedIn).toContainText("от Кирилл Тестов");
  await expect(block.locator(`[data-incoming-idea="${sharedInId}"]`)).toHaveCount(0);

  // Отправленная своя ушла из списка — в окно «Отправленные», где видно,
  // кто что ответил.
  await expect(page.locator(`#ideaList [data-idea-id="${awayId}"]`)).toHaveCount(0);
  await page.locator("#ideasSentBtn").click();
  const sentRow = page.locator(`#sentIdeasModal [data-sent-idea="${awayId}"]`);
  await expect(sentRow).toContainText("Договор аренды — продлить");
  await expect(sentRow).toContainText("Кирилл Тестов — не ответил");
  await page.keyboard.press("Escape");
  await expect(page.locator("#sentIdeasModal")).toHaveCount(0);

  // Поделённая своя осталась в списке: число ответивших из тех, с кем
  // поделился, а по наведению — список, тоже без «(я)».
  const chip = page.locator(`[data-idea-sent="${sentId}"]`);
  // У поделённой ответа не ждут — просто число людей, без «1/2».
  await expect(chip).toHaveText(/^\s*2\s*$/);
  await chip.hover();
  const tip = page.locator("#ideaSentTooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Кирилл Тестов");
  await expect(tip).toContainText("Анна Проверкина");
  await expect(tip).toContainText("убрал у себя");
  await expect(tip).toContainText("видит");
  await expect(tip).not.toContainText("(я)");
  // Целиком в окне, и строки не торчат за её край — «не ответил» вылезал
  // наружу (его снимок 07.10.2026).
  const fits = await tip.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const rowsFit = [...el.querySelectorAll<HTMLElement>(".prow")].every((row) => row.scrollWidth <= row.clientWidth + 1);
    return r.left >= 0 && r.right <= window.innerWidth && rowsFit && el.scrollWidth <= el.clientWidth + 1;
  });
  expect(fits).toBe(true);
  await page.mouse.move(0, 0);

  // Повторное открытие: блок рисуется ВМЕСТЕ с мыслями, а не через
  // секунду после них (07.10.2026: «появляется с задержкой… все разделы
  // должны открываться синхронно»). Проверка в тот же миг, когда появился
  // список мыслей, без ожидания — ожидание и спрятало бы задержку.
  await page.reload();
  await page.locator("#ideaList").waitFor({ timeout: 25_000 });
  expect(await page.locator("#incomingIdeas").count()).toBe(1);

  // «Сохранить» кладёт копию в мои мысли — она встаёт в мой список.
  const keep = block.locator(`[data-incoming-idea="${keepId}"]`);
  await keep.getByRole("button", { name: "Сохранить" }).click();
  await expect(keep).toHaveCount(0);
  await expect(page.locator("#ideaList .idea-item").filter({ hasText: "Книга про переговоры — прочитать" })).toBeVisible();

  // «Принял» убирает мысль из блока и записывается в базу.
  await incoming.getByRole("button", { name: "Принял" }).click();
  await expect(block).toHaveCount(0);
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("idea_recipients")
        .select("seen_at, converted_task_id")
        .eq("idea_id", incomingId)
        .maybeSingle();
      return !!data?.seen_at && !data?.converted_task_id;
    })
    .toBe(true);

  // И после перезагрузки не возвращается.
  await page.reload();
  await expect(page.locator(`[data-idea-sent="${sentId}"]`)).toBeVisible({ timeout: 25_000 });
  await expect(page.locator("#incomingIdeas")).toHaveCount(0);
});
