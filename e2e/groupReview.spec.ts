import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { userFilePath } from "./userFile";

// Приёмка групповой задачи глазами постановщика (21.10.2026, задача №111).
//
// Шестеро изучали книгу каждый сам, один случайно нажал «сдал целиком», и
// возврат на доработку снимал отчёты у всех. Здесь проверяется то, чего не
// видит test:ten (он ходит в маршрут): что окно возврата спрашивает
// «Кому вернуть» кнопками, не отпускает без выбора, а возврат одному
// оставляет «Сделал» у остальных — в базе, а не только на экране; и что
// «Дождаться всех» стоит там, где его ищут.
//
// Исполнители — люди без входа: отчёты за них ставит служебный ключ. Для
// постановщика это неотличимо от настоящих отчётов, а второй вход в тест
// ради них не нужен.

const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#newTaskBtn")).toBeVisible();
}

// Три человека не «(я)» — список сеет движок синхронизации после первой
// загрузки, поэтому ждём его в базе.
async function threePeople(): Promise<{ id: string; name: string }[]> {
  for (let i = 0; i < 40; i++) {
    const { data } = await admin.from("assignees").select("id, name").eq("user_id", userId).is("archived_at", null);
    const others = ((data || []) as { id: string; name: string }[]).filter((p) => !p.name.includes("(я)"));
    if (others.length >= 3) return others.slice(0, 3);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("У тестового аккаунта нет трёх людей");
}

// Задача на троих: двое отчитались, третий молчит, а задача на приёмке —
// ровно то состояние, которое оставляет «сдал целиком».
async function handedInWhole(title: string) {
  const people = await threePeople();
  const id = randomUUID();
  const { error } = await admin.from("tasks").insert({
    id,
    user_id: userId,
    title,
    description: "",
    assignee: people[0].name,
    priority: "med",
    term: "short",
    status: "in_progress",
    deadline: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
    approval_state: "awaiting_review",
  });
  if (error) throw new Error(error.message);
  const now = new Date().toISOString();
  const rows = people.map((p, i) => ({
    user_id: userId,
    task_id: id,
    assignee_id: p.id,
    role: "executor",
    accepted_at: now,
    done_at: i < 2 ? now : null,
    done_comment: i < 2 ? `Прочитал, ${i + 1}` : null,
  }));
  // Триггер 0024 мог уже завести первого — его строку дописываем отчётом.
  const { error: pErr } = await admin.from("task_participants").upsert(rows, { onConflict: "task_id,assignee_id" });
  if (pErr) throw new Error(pErr.message);
  return { id, people };
}

async function doneOf(taskId: string): Promise<Record<string, string | null>> {
  const { data } = await admin.from("task_participants").select("assignee_id, done_at").eq("task_id", taskId);
  return Object.fromEntries(((data || []) as { assignee_id: string; done_at: string | null }[]).map((r) => [r.assignee_id, r.done_at]));
}

test("возврат групповой задачи спрашивает, кому, и не трогает отчёты остальных", async ({ page }) => {
  const title = `E2E групповой возврат ${Date.now()}`;
  test.setTimeout(90_000);
  // Сначала вход: список людей у нового аккаунта сеет трекер при первой
  // загрузке, до неё класть задачу не на кого.
  await login(page);
  const { id, people } = await handedInWhole(title);
  await page.reload();

  await page.locator("#col-review .task", { hasText: title }).click();
  const review = page.locator("#taskDecisions .tp-review");
  await expect(review).toContainText("Задачу сдали целиком, хотя ответили не все");
  await expect(review.locator("#waitForAllBtn")).toBeVisible();

  await review.locator(".btn", { hasText: "Вернуть на доработку" }).click();
  const chips = page.locator(".ask-pick .participant-chip");
  // Вернуть можно только ответившим: двое, молчащего в выборе нет.
  await expect(chips).toHaveCount(2);
  await page.fill("#askInput", "Сделано не полностью");
  await page.click("#askOkBtn");
  await expect(page.locator(".ask-problem")).toHaveText("Отметьте, кому вернуть на доработку.");

  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.click("#askOkBtn");
  await expect(page.locator("#overlay")).toHaveCount(0, { timeout: 15_000 });

  // В базе: снят отчёт только у отмеченного (второго), первый остался.
  await expect.poll(async () => (await doneOf(id))[people[1].id], { timeout: 15_000 }).toBeNull();
  const after = await doneOf(id);
  expect(after[people[0].id]).toBeTruthy();
  const { data: row } = await admin.from("tasks").select("approval_state, approval_comment").eq("id", id).maybeSingle();
  expect(row?.approval_state).toBe("returned");
  expect(String(row?.approval_comment)).toContain(people[1].name.replace(/\s*\(я\)\s*$/, ""));

  await admin.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id);
});

test("«Дождаться всех» возвращает задачу в работу, не снимая отчётов", async ({ page }) => {
  const title = `E2E дождаться всех ${Date.now()}`;
  test.setTimeout(90_000);
  // Сначала вход: список людей у нового аккаунта сеет трекер при первой
  // загрузке, до неё класть задачу не на кого.
  await login(page);
  const { id, people } = await handedInWhole(title);
  await page.reload();

  await page.locator("#col-review .task", { hasText: title }).click();
  await page.locator("#waitForAllBtn").click();
  await expect(page.locator("#overlay")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("#col-work .task", { hasText: title })).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(async () => (await admin.from("tasks").select("approval_state").eq("id", id).maybeSingle()).data?.approval_state, { timeout: 15_000 })
    .toBe("open");
  const after = await doneOf(id);
  expect(after[people[0].id]).toBeTruthy();
  expect(after[people[1].id]).toBeTruthy();

  await admin.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id);
});
