import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";
import { pickSelfExecutor } from "./helpers";

// Сторожа к предложениям, сделанным 07.10.2026 (docs/proposals-2026-10.md):
// номер задачи, регулярная встреча, «меня не будет». Каждое проверяется по
// БАЗЕ, а не только по экрану — «сохранено» здесь обещание, а не надпись.

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

test("у новой задачи появляется номер, и поиск находит её по нему", async ({ page }) => {
  await login(page);
  const title = "Номер " + Date.now();
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: title });
  // Номер ставит база — на карточку он приезжает эхом строки.
  await expect(card.locator(".task-num")).toHaveText(/^#\d+$/, { timeout: 20_000 });
  const shown = Number((await card.locator(".task-num").innerText()).slice(1));
  const { data } = await admin.from("tasks").select("number").eq("user_id", ownerId).eq("title", title).single();
  expect(data?.number).toBe(shown);

  await page.click("#searchBtn");
  const search = page.locator("#searchInput");
  await expect(search).toBeVisible();
  await search.fill("#" + shown);
  await expect(page.locator("dialog[open]").getByText(title).first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("встреча с повтором записывает правило, и его видно в самой встрече", async ({ page }) => {
  await login(page);
  const title = "Планёрка " + Date.now();
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  await page.locator("#mRecur").getByText("Каждую неделю", { exact: true }).click();
  await page.click("#meetingSaveBtn");
  const chip = page.locator(".meeting-chip", { hasText: title });
  await expect(chip).toBeVisible();
  await expect
    .poll(async () => (await admin.from("meetings").select("recur").eq("user_id", ownerId).eq("title", title).maybeSingle()).data?.recur, {
      timeout: 20_000,
    })
    .toBe("weekly");

  await chip.click();
  await expect(page.locator(".meeting-recur-note")).toContainText("каждую неделю");
  await page.click("#meetingStopRepeat");
  await expect
    .poll(async () => (await admin.from("meetings").select("recur").eq("user_id", ownerId).eq("title", title).maybeSingle()).data?.recur, {
      timeout: 20_000,
    })
    .toBe("none");
});

test("«Меня не будет…» отмечает отпуск, и его видно в форме задачи", async ({ page }) => {
  await login(page);
  await page.click("#accountBtn");
  await page.getByText("Меня не будет…", { exact: true }).click();
  const ask = page.locator(".ask-modal");
  await ask.getByRole("button", { name: "Отпуск", exact: true }).click();
  await ask.getByRole("button", { name: "Неделю", exact: true }).click();
  await expect
    .poll(async () => {
      const { data } = await admin.from("assignees").select("name, away_until, away_kind").eq("user_id", ownerId);
      return (data || []).find((a) => /\(я\)\s*$/.test(a.name as string))?.away_kind;
    }, { timeout: 20_000 })
    .toBe("vacation");

  await page.click("#newTaskBtn");
  await expect(page.locator('#fPeople .participant-chip[data-self="true"] .chip-away')).toContainText("нет до", { timeout: 20_000 });
  await page.keyboard.press("Escape");

  // Вернуться — тем же пунктом.
  await page.click("#accountBtn");
  await page.getByText(/^Меня нет:/).click();
  await page.locator(".ask-modal").getByRole("button", { name: "Я на месте", exact: true }).click();
  await expect
    .poll(async () => {
      const { data } = await admin.from("assignees").select("name, away_until").eq("user_id", ownerId);
      return (data || []).find((a) => /\(я\)\s*$/.test(a.name as string))?.away_until ?? null;
    }, { timeout: 20_000 })
    .toBeNull();
});
