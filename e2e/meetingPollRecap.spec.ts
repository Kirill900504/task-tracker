import { test, expect, type Page } from "@playwright/test";
import { CARD_CORNER } from "./helpers";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { userFilePath } from "./userFile";

// Встречи, одобрено 14.10.2026: итог одной кнопкой превращается в
// поручения (предложение 4) и опрос времени с вариантами (предложение 9).
// Записанное проверяется запросом к базе.

const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
}

async function freeSlot(page: Page, skip: string[] = []): Promise<string> {
  const slots = page.locator("#mTimeGrid .time-slot:enabled:not(.selected)");
  const count = await slots.count();
  for (let i = 0; i < count; i++) {
    const t = ((await slots.nth(i).textContent()) || "").trim();
    if (t && !skip.includes(t)) {
      await page.locator("#mTimeGrid .time-slot", { hasText: t }).click();
      return t;
    }
  }
  throw new Error("нет свободного времени");
}

async function newMeeting(page: Page, title: string) {
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  await page.locator("#meetingOverlay .deadline-row .participant-chip", { hasText: "Завтра" }).click();
  await page.locator("#mParticipants .participant-chip").first().click();
}

test("закрытая встреча предлагает задачи из повестки", async ({ page }) => {
  test.setTimeout(120_000);
  const title = `E2E итог-поручения ${Date.now()}`;
  await login(page);
  await newMeeting(page, title);
  await freeSlot(page);
  await page.click("#meetingSaveBtn");
  const chip = page.locator(".meeting-chip", { hasText: title });
  await expect(chip).toBeVisible();
  await chip.click(CARD_CORNER);
  const stamp = Date.now();
  for (const item of [`Обзвонить филиалы ${stamp}`, `Сверить прайс ${stamp}`]) {
    await page.fill("#agendaInput", item);
    await page.press("#agendaInput", "Enter");
  }
  await expect(page.locator("#meetingAgenda .agenda-item")).toHaveCount(2);
  // Ждём, пока оба пункта доедут до базы: окно читает повестку оттуда.
  await expect
    .poll(async () => {
      const { data } = await admin.from("meeting_agenda").select("id").like("text", `%${stamp}`);
      return (data || []).length;
    }, { timeout: 20_000 })
    .toBe(2);
  // Итог — рассказ, а не список дел: задачами его больше не режут.
  await page.fill("#mResult", "Поговорили обо всём");
  await page.click("#markSuccessBtn");
  // Повестка из двух пунктов — окно задач само.
  const sheet = page.locator("#recapTasksSheet");
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(sheet.locator(".recap-row")).toHaveCount(2);
  await expect(sheet.locator(".recap-title").first()).toHaveValue(`Обзвонить филиалы ${stamp}`);
  await expect(sheet.locator("#recapTasksSkip")).toHaveText("Не ставить задачей");
  await page.click("#recapTasksCreate");
  await expect
    .poll(async () => {
      const { data } = await admin.from("tasks").select("title, description, deadline").eq("user_id", userId).like("title", `%${stamp}`);
      return (data || []).filter((t) => (t.description as string).startsWith("По итогам встречи") && !!t.deadline).length;
    }, { timeout: 30_000 })
    .toBe(2);
});

test("опрос времени: варианты, и организатор назначает один", async ({ page }) => {
  test.setTimeout(120_000);
  const title = `E2E опрос ${Date.now()}`;
  await login(page);
  await newMeeting(page, title);
  const first = await freeSlot(page);
  await expect(page.locator("#addSlotBtn")).toHaveText("+ Предложить время");
  await page.click("#addSlotBtn");
  await expect(page.locator("#pollForm .poll-extra")).toHaveCount(1);
  const second = await freeSlot(page, [first]);
  // Выбранное в сетке входит в опрос и без нажатия — список это показывает.
  await expect(page.locator("#pollForm .poll-extra")).toHaveCount(2);
  await expect(page.locator("#pollForm .poll-form-count")).toHaveText("2 из 3");
  await page.click("#meetingSaveBtn");

  // В базе — предложение с двумя вариантами: выбранное при сохранении первым.
  type Row = { id: string; status: string; time: string; slot_options: { date: string; time: string }[] };
  let row: Row | null = null;
  await expect
    .poll(async () => {
      const { data } = await admin.from("meetings").select("id, status, time, slot_options").eq("user_id", userId).eq("title", title).maybeSingle();
      row = data as Row | null;
      return row ? `${row.status}:${row.slot_options.map((o) => o.time).join(",")}` : "";
    }, { timeout: 30_000 })
    .toBe(`proposed:${second},${first}`);

  // В списке — «Опрос времени», в окне — варианты, организатор назначает.
  const chip = page.locator(".meeting-chip", { hasText: title });
  await expect(chip.locator(".pill-proposed")).toHaveText("Опрос времени");
  await chip.click(CARD_CORNER);
  const poll = page.locator("#meetingPoll");
  await expect(poll.locator(".poll-row")).toHaveCount(2);
  await poll.locator('.poll-row[data-slot="1"]').getByRole("button", { name: "Назначить" }).click();
  await expect
    .poll(async () => {
      const { data } = await admin.from("meetings").select("status, time, slot_options").eq("id", row!.id).maybeSingle();
      const r = data as { status: string; time: string; slot_options: unknown[] } | null;
      return r ? `${r.status}:${r.time}:${r.slot_options.length}` : "";
    }, { timeout: 30_000 })
    .toBe(`planned:${first}:0`);
});
