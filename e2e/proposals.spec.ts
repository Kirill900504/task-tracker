import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";
import { pickSelfExecutor, CARD_CORNER } from "./helpers";

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

test("«Пригласить всех» в «Команде» выдаёт приглашение каждому неподключённому одним блоком", async ({ page }) => {
  const name = "Неподключённый " + Date.now();
  await admin.from("assignees").insert({ user_id: ownerId, name });
  await login(page);
  await page.click("#teamBtn");
  await page.click("#inviteAllBtn");
  // Мессенджер больше не спрашивается: человек выбирает его сам на
  // странице приглашения.
  const block = page.locator("#bulkInviteBlock");
  await expect(block).toContainText(name, { timeout: 20_000 });
  await expect(block).toContainText("/welcome/");
  await expect(block.getByRole("button", { name: "Скопировать всё" })).toBeVisible();
});

test("готовый ответ вставляется в отчёт одним нажатием, но не отправляет его сам", async ({ page, browser }) => {
  // Отвечают на ЧУЖОЕ поручение: у задачи самому себе кнопок «Сделал» нет
  // (так решил Кирилл 07.10.2026 — отчитываться перед собой незачем).
  // Поэтому задача заводится формой на себя, а потом её «поручает» другой
  // человек — временный, и он же убирается в конце.
  const stamp = Date.now();
  const { data: helper } = await admin.auth.admin.createUser({ email: `qa-helper-${stamp}@example.invalid`, password: crypto.randomUUID(), email_confirm: true });
  try {
    await login(page);
    const title = "Готовый ответ " + stamp;
    await page.click("#newTaskBtn");
    await page.fill("#fTitle", title);
    await pickSelfExecutor(page);
    await page.click("#saveTaskBtn");
    await expect(page.locator(".task", { hasText: title })).toBeVisible();
    let id = "";
    await expect
      .poll(async () => {
        const { data } = await admin.from("tasks").select("id").eq("user_id", ownerId).eq("title", title).maybeSingle();
        id = (data?.id as string) || "";
        return !!id;
      }, { timeout: 20_000 })
      .toBe(true);
    // Сначала должна доехать строка исполнителя: после смены постановщика
    // база по праву не даст владельцу ставить людей в чужую задачу.
    await expect
      .poll(async () => (await admin.from("task_participants").select("id").eq("task_id", id)).data?.length || 0, { timeout: 20_000 })
      .toBeGreaterThan(0);
    expect((await admin.from("tasks").update({ created_by: helper.user!.id }).eq("id", id)).error).toBeNull();

    // Чистое окно браузера: после перезагрузки трекер рисует первый кадр
    // из своей копии, а смену постановщика в обход интерфейса она не знает
    // (в жизни постановщик у задачи не меняется).
    const fresh = await (await browser.newContext()).newPage();
    await login(fresh);
    const card = fresh.locator(`.task[data-id="${id}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click(CARD_CORNER);
    const modal = fresh.locator("dialog[open]").filter({ has: fresh.locator("#modalTitle") });
    await modal.getByRole("button", { name: "Сделал" }).click({ timeout: 20_000 });
    await modal.locator(".ms-answer-quick").getByRole("button", { name: "Готово, проверьте" }).click();
    await expect(modal.locator("#myWorkDone")).toHaveValue("Готово, проверьте");
    // Не отправилось само: форма на месте, кнопка отправки ждёт.
    await expect(modal.getByRole("button", { name: "Готово", exact: true })).toBeVisible();
    await fresh.context().close();
  } finally {
    if (helper?.user) await admin.auth.admin.deleteUser(helper.user.id);
  }
});

test("«Повторить» у закрытой задачи открывает новую с тем же названием и без срока", async ({ page }) => {
  await login(page);
  const title = "Повтор " + Date.now();
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await card.locator(".check").click();
  // Закрытая сразу уходит с доски в «Завершённые» — их надо показать.
  const doneBtn = page.locator("#showDoneCheckbox");
  if ((await doneBtn.getAttribute("aria-pressed")) !== "true") await doneBtn.click();
  const closed = page.locator(".task.done", { hasText: title }).first();
  await expect(closed).toBeVisible({ timeout: 20_000 });
  await closed.click();
  await page.click("#repeatTaskBtn");
  await expect(page.locator("#modalTitle")).toHaveText("Новая задача");
  await expect(page.locator("#fTitle")).toHaveValue(title);
  await expect(page.locator('#fPeople .participant-chip[data-self="true"]')).toHaveClass(/role-executor/);
  await page.keyboard.press("Escape");
});

test("повестка задаётся в форме новой встречи, между названием и датой, и доезжает до базы", async ({ page }) => {
  await login(page);
  const title = "Повестка при создании " + Date.now();
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  // Место поля — его слова 21.10.2026: «между названием встречи и датой».
  const titleBox = await page.locator("#mTitle").boundingBox();
  const agendaBox = await page.locator("#mAgenda").boundingBox();
  const dateBox = await page.locator(".modal label", { hasText: /^Дата$/ }).boundingBox();
  expect(agendaBox!.y).toBeGreaterThan(titleBox!.y);
  expect(dateBox!.y).toBeGreaterThan(agendaBox!.y);
  await page.fill("#mAgenda", "Смета");
  await page.locator("#mAgenda").press("Enter");
  await expect(page.locator("#agendaDraft .agenda-item", { hasText: "Смета" })).toBeVisible();
  // Второй пункт НЕ добавлен Enter'ом — форма обязана забрать его сама.
  await page.fill("#mAgenda", "Отпуска");
  await page.click("#meetingSaveBtn");
  await expect(page.locator(".meeting-chip", { hasText: title })).toBeVisible();
  let meetingId: string | undefined;
  await expect
    .poll(async () => (meetingId = (await admin.from("meetings").select("id").eq("user_id", ownerId).eq("title", title).maybeSingle()).data?.id), { timeout: 20_000 })
    .toBeTruthy();
  await expect
    .poll(async () => ((await admin.from("meeting_agenda").select("text").eq("meeting_id", meetingId).order("position")).data || []).map((r) => r.text), { timeout: 20_000 })
    .toEqual(["Смета", "Отпуска"]);
});

test("повестка: пункт дописывается, получает итог и становится задачей", async ({ page }) => {
  await login(page);
  const title = "Повестка " + Date.now();
  await page.click("#addMeetingBtn");
  await page.fill("#mTitle", title);
  await page.click("#meetingSaveBtn");
  const chip = page.locator(".meeting-chip", { hasText: title });
  await expect(chip).toBeVisible();
  // Строка встречи должна доехать до базы, прежде чем к ней цепляться.
  await expect
    .poll(async () => (await admin.from("meetings").select("id").eq("user_id", ownerId).eq("title", title).maybeSingle()).data?.id, { timeout: 20_000 })
    .toBeTruthy();
  await chip.click();
  const point = "Смета по складу";
  await page.fill("#agendaInput", point);
  await page.locator("#agendaInput").press("Enter");
  await expect(page.locator(".agenda-item", { hasText: point })).toBeVisible();
  // Ровно ОДНА строка у этой встречи, а не «хотя бы одна»: прежняя проверка
  // с limit(1) не видела, что одно нажатие Enter писало пункт дважды
  // (ленивый запрос, ждали дважды — см. useMeetingAgenda.add). Пауза — чтобы
  // вторая вставка, если бы она была, успела доехать.
  const meetingId = (await admin.from("meetings").select("id").eq("user_id", ownerId).eq("title", title).maybeSingle()).data?.id;
  await expect
    .poll(async () => (await admin.from("meeting_agenda").select("id").eq("meeting_id", meetingId)).data?.length || 0, { timeout: 20_000 })
    .toBe(1);
  await page.waitForTimeout(1500);
  expect((await admin.from("meeting_agenda").select("id").eq("meeting_id", meetingId)).data?.length).toBe(1);
  await expect(page.locator(".agenda-item")).toHaveCount(1);

  await page.locator(".agenda-item", { hasText: point }).getByRole("button", { name: "Итог" }).click();
  const ask = page.locator(".ask-modal");
  await ask.locator("textarea, input").first().fill("Игорь считает до пятницы");
  await ask.getByRole("button", { name: "Записать" }).click();
  await expect(page.locator(".agenda-note")).toContainText("Игорь считает до пятницы");

  await page.locator(".agenda-item", { hasText: point }).getByRole("button", { name: "В задачу" }).click();
  await expect(page.locator("#modalTitle")).toHaveText("Новая задача");
  await expect(page.locator("#fTitle")).toHaveValue(point);
  await page.keyboard.press("Escape");
});

test("«Отложить…» убирает задачу с доски автора до выбранного дня", async ({ page }) => {
  await login(page);
  const title = "Отложить " + Date.now();
  await page.click("#newTaskBtn");
  await page.fill("#fTitle", title);
  await pickSelfExecutor(page);
  await page.click("#saveTaskBtn");
  const card = page.locator(".task", { hasText: title });
  await expect(card).toBeVisible();
  await card.click(CARD_CORNER);
  // Кнопка — в строке срока, а не значком в шапке (20.10.2026).
  await expect(page.locator("#selfDeadline #snoozeTaskBtn")).toBeVisible();
  await page.click("#snoozeTaskBtn");
  // День выбирают календарём, как срок; рядом — «Завтра» и «Через неделю».
  await expect(page.locator(".ask-modal #snoozeCal .mini-cal-trigger")).toBeVisible();
  await expect(page.locator(".ask-modal").getByRole("button", { name: /^Через неделю,/ })).toBeVisible();
  await page.locator(".ask-modal").getByRole("button", { name: /^Завтра,/ }).click();
  await expect(card).toBeHidden();
  await expect
    .poll(async () => (await admin.from("tasks").select("snoozed_until").eq("user_id", ownerId).eq("title", title).maybeSingle()).data?.snoozed_until, {
      timeout: 20_000,
    })
    .toBeTruthy();
  // Отложенное не потерялось: кнопка с числом возвращает его на доску.
  await page.click("#showSnoozedBtn");
  await expect(card).toBeVisible();
  // Режим говорит о себе словами, а карточка — днём возвращения.
  await expect(page.locator("#snoozedBanner")).toBeVisible();
  await expect(card).toContainText("Отложена до");
  await page.locator("#snoozedBanner").getByRole("button", { name: "Вся доска" }).click();
  await expect(card).toBeHidden();
});

test("в окне приёмки четыре готовых ответа, и нажатие только вставляет фразу", async ({ page }) => {
  // Задача владельца на временном человеке, уже отчитавшемся: так блок
  // «Принимаете работу?» стоит в карточке без второго входа в трекер.
  const stamp = Date.now();
  const name = `QA Приёмка ${stamp}`;
  const id = `qa-approve-${stamp}`;
  const { data: person } = await admin.from("assignees").insert({ user_id: ownerId, name }).select("id").single();
  try {
    const title = "Приёмка готовым ответом " + stamp;
    expect(
      (
        await admin.from("tasks").insert({
          id, user_id: ownerId, title, assignee: name, status: "in_progress",
          approval_state: "awaiting_review", deadline: "2030-01-01",
        })
      ).error,
    ).toBeNull();
    // Триггер 0024 мог уже завести строку по имени — тогда просто отмечаем отчёт.
    await admin.from("task_participants").upsert(
      { user_id: ownerId, task_id: id, assignee_id: person!.id, role: "executor" },
      { onConflict: "task_id,assignee_id", ignoreDuplicates: true },
    );
    expect(
      (await admin.from("task_participants").update({ done_at: new Date().toISOString(), done_comment: "Готово" }).eq("task_id", id)).error,
    ).toBeNull();

    await login(page);
    const card = page.locator(`.task[data-id="${id}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click(CARD_CORNER);
    await page.locator(".tp-review-actions .btn", { hasText: "Принять" }).click({ timeout: 20_000 });
    const ask = page.locator(".ask-modal");
    await expect(ask.locator(".ask-quick button")).toHaveCount(4);
    await ask.locator(".ask-quick button", { hasText: "Принято, всё сделано" }).click();
    await expect(page.locator("#askInput")).toHaveValue("Принято, всё сделано");
    // Не отправилось само: окно на месте, задача по-прежнему на приёмке.
    await expect(page.locator("#askOkBtn")).toBeVisible();
    await page.click("#askCancelBtn");
    const { data } = await admin.from("tasks").select("approval_state").eq("id", id).single();
    expect(data?.approval_state).toBe("awaiting_review");
  } finally {
    await admin.from("tasks").delete().eq("id", id);
    if (person) await admin.from("assignees").delete().eq("id", person.id);
  }
});
