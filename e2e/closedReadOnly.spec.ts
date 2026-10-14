import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { userFilePath } from "./userFile";

// Закрытое событие — только просмотр (14.10.2026, «в ранее завершённой
// задаче и постановщик и исполнитель могут спокойно менять данные,
// удалять сообщения и переписываться. Запрети любые изменения или
// дополнения уже закрытых событий»).
//
// Две половины, и обе нужны. Экран: в карточке закрытой задачи нет поля
// ввода, «Отложить» и «Удалить», а «Повторить» есть — это новая задача, а
// не правка этой. База (миграция 0056): даже мимо экрана, своим входом,
// написать в обсуждение закрытой задачи или встречи и поправить старую
// реплику нельзя — иначе запрет живёт до первой старой вкладки.

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
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
}

test("закрытая задача открывается только для просмотра", async ({ page }) => {
  const db = admin();
  const id = `e2e-closed-${Date.now()}`;
  const title = `E2E закрытая ${Date.now()}`;
  const { error } = await db.from("tasks").insert({ id, user_id: userId, title, status: "done", approval_state: "accepted" });
  expect(error).toBeNull();
  // Реплика, написанная, пока задача была открыта: её нельзя ни править, ни убрать.
  const { data: said } = await db
    .from("item_comments")
    .insert({ item_kind: "task", item_id: id, body: "сказано до закрытия", author_user_id: userId, source: "app" })
    .select("id")
    .single();

  try {
    await login(page);
    const done = page.locator("#showDoneCheckbox");
    if ((await done.getAttribute("aria-pressed")) !== "true") await done.click();
    const card = page.locator(".task", { hasText: title });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click();

    await expect(page.locator("#chatClosedNote")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".chat-composer")).toHaveCount(0);
    await expect(page.locator("#deleteTaskBtn")).toHaveCount(0);
    await expect(page.locator("#snoozeTaskBtn")).toHaveCount(0);
    await expect(page.locator("#repeatTaskBtn")).toBeVisible();

    // Меню по правой кнопке на старой реплике — только «Копировать».
    const msg = page.locator(".chat-msg", { hasText: "сказано до закрытия" });
    await msg.click({ button: "right" });
    await expect(page.locator(".chat-menu-item", { hasText: "Копировать" })).toBeVisible();
    await expect(page.locator(".chat-menu-item", { hasText: "Изменить" })).toHaveCount(0);
    await expect(page.locator(".chat-menu-item", { hasText: "Убрать" })).toHaveCount(0);
    await expect(page.locator(".chat-menu-emojis")).toHaveCount(0);
  } finally {
    await db.from("item_comments").delete().eq("item_id", id);
    await db.from("tasks").delete().eq("id", id);
  }
  expect(said).not.toBeNull();
});

test("база не пускает в обсуждение закрытого даже мимо экрана", async () => {
  const db = admin();
  const taskId = `e2e-closed-db-${Date.now()}`;
  const meetingId = randomUUID();
  await db.from("tasks").insert({ id: taskId, user_id: userId, title: "E2E закрытая (база)", status: "done" });
  await db.from("meetings").insert({
    id: meetingId,
    user_id: userId,
    date: "2026-01-15",
    time: "10:00",
    title: "E2E прошедшая встреча",
    participants: [],
    status: "success",
    duration_min: 30,
  });
  const { data: old } = await db
    .from("item_comments")
    .insert({ item_kind: "task", item_id: taskId, body: "до закрытия", author_user_id: userId, source: "app" })
    .select("id")
    .single();
  const oldId = (old as { id: string }).id;

  const me = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    const { error: signInError } = await me.auth.signInWithPassword({ email, password });
    expect(signInError).toBeNull();

    for (const [kind, id] of [["task", taskId], ["meeting", meetingId]] as const) {
      const { error } = await me.from("item_comments").insert({ item_kind: kind, item_id: id, body: "после закрытия", author_user_id: userId, source: "app" });
      expect(error, `реплика в закрытую ${kind}`).not.toBeNull();
    }

    // Правка и «Убрать» (deleted_at) — тоже UPDATE, и тоже мимо.
    await me.from("item_comments").update({ body: "переписано" }).eq("id", oldId);
    await me.from("item_comments").update({ deleted_at: new Date().toISOString() }).eq("id", oldId);
    const { data: still } = await db.from("item_comments").select("body, deleted_at").eq("id", oldId).single();
    expect(still).toEqual({ body: "до закрытия", deleted_at: null });

    const { error: reactError } = await me.from("comment_reactions").insert({ comment_id: oldId, actor_user_id: userId, emoji: "👍" });
    expect(reactError).not.toBeNull();
  } finally {
    await me.auth.signOut().catch(() => {});
    await db.from("item_comments").delete().in("item_id", [taskId, meetingId]);
    await db.from("tasks").delete().eq("id", taskId);
    await db.from("meetings").delete().eq("id", meetingId);
  }
});
