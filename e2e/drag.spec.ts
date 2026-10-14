import { test, expect, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";
import { centerOnScreen } from "./helpers";

// Место взятой карточки обязано быть ПУСТЫМ — и проверить это может только
// браузер.
//
// 22.09.2026 Кирилл прислал снимок доски и слова: «опять ошибка со
// склейкой двух задач, и они не расступаются, а ходят парой, и между ними
// ничего не вставишь». Ошибка была не в перетаскивании — оно считало всё
// верно, соседи расступались, каждая позиция была достижима. Ошибка была в
// том, КАК это выглядит: правило `.task.dragging` (прозрачный фон, нет
// рамки) стоит в tracker.css выше, чем `.task.role-executor`,
// `.task.overdue` и `.task.due-today`, а при равной специфичности
// побеждает то, что ниже. Место взятой карточки оставалось залитым и с
// рамкой — то есть второй такой же карточкой, только без текста. «Пара» —
// это карточка под курсором и её собственный призрак.
//
// Прочитать это в коде нельзя: класс стоит, правило написано, стили
// «выглядят исправными». Поэтому здесь спрашивается вычисленный фон —
// ровно тот же приём, что в roles.spec.ts, и ровно по той же причине.

const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Прозрачным в вычисленных стилях бывает и `rgba(0, 0, 0, 0)`, и
// `transparent`: сверяемся с альфой, а не со строкой.
function isTransparent(color: string): boolean {
  if (color === "transparent") return true;
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return false;
  const parts = m[1].split(",").map((p) => Number(p.trim()));
  return parts.length === 4 && parts[3] === 0;
}

// Взять элемент мышью и, не отпуская, отдать то, как выглядит оставшееся
// на его месте. Порог переноса — 6 пикселей (TrackerDnd), поэтому сдвиг
// заведомо больше; отпускание идёт через Escape, чтобы проверка ничего не
// переставила.
async function ghostStyleOf(page: Page, card: Locator, ghost: Locator) {
  await centerOnScreen(card);
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height / 2 + 28, { steps: 5 });
  await expect(ghost).toBeVisible({ timeout: 5_000 });
  const style = await ghost.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, border: s.borderTopColor };
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(200);
  return style;
}

test("место взятой карточки ничем не закрашено", async ({ page }) => {
  const stamp = Date.now().toString(36);

  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });

  const { data: people } = await admin.from("assignees").select("id, name").eq("user_id", userId);
  const me = ((people || []) as { id: string; name: string }[]).find((p) => p.name.includes("(я)"));
  expect(me, "в списке людей нет своей строки «(я)»").toBeTruthy();

  // Три карточки, которые раньше оставляли за собой цветное место: моя
  // (фирменный фон исполнителя), просроченная (красная заливка) и та, чей
  // срок сегодня (своя заливка).
  const ids = {
    mine: `drag-mine-${stamp}`,
    late: `drag-late-${stamp}`,
    today: `drag-today-${stamp}`,
  };
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const { error: taskError } = await admin.from("tasks").insert([
    { id: ids.mine, user_id: userId, title: `E2E перенос моя ${stamp}`, assignee: "", status: "in_progress", deadline: null },
    { id: ids.late, user_id: userId, title: `E2E перенос просрочена ${stamp}`, assignee: "", status: "in_progress", deadline: "2020-01-01" },
    { id: ids.today, user_id: userId, title: `E2E перенос сегодня ${stamp}`, assignee: "", status: "in_progress", deadline: todayIso },
  ]);
  expect(taskError).toBeNull();

  const { error: partError } = await admin.from("task_participants").insert([
    { user_id: userId, task_id: ids.mine, assignee_id: me!.id, role: "executor" },
    { user_id: userId, task_id: ids.late, assignee_id: me!.id, role: "executor" },
    { user_id: userId, task_id: ids.today, assignee_id: me!.id, role: "executor" },
  ]);
  expect(partError).toBeNull();

  await page.reload();
  for (const id of Object.values(ids)) {
    await expect(page.locator(`.task[data-id="${id}"]`)).toBeVisible({ timeout: 30_000 });
  }
  // Роль приезжает вторым запросом — без неё карточка ещё не покрашена, и
  // проверять было бы нечего.
  await expect(page.locator(`.task[data-id="${ids.mine}"]`)).toHaveAttribute("data-role", "executor", { timeout: 30_000 });

  for (const [what, id] of Object.entries(ids)) {
    const card = page.locator(`.task[data-id="${id}"]`);
    const style = await ghostStyleOf(page, card, page.locator(`.task[data-id="${id}"].dragging`));
    expect(isTransparent(style.bg), `место взятой карточки (${what}) залито ${style.bg}`).toBe(true);
    expect(isTransparent(style.border), `у места взятой карточки (${what}) осталась рамка ${style.border}`).toBe(true);
  }
});

test("место взятой мысли ничем не закрашено", async ({ page }) => {
  const stamp = Date.now().toString(36);

  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });

  // Важная мысль — тот же случай: `.idea-item.important` стоит в файле
  // ниже `.idea-item.dragging`.
  const text = `E2E перенос мысль ${stamp}`;
  const { error } = await admin
    .from("ideas")
    .insert([{ id: `drag-idea-${stamp}`, user_id: userId, text, important: true, done: false }]);
  expect(error).toBeNull();

  await page.reload();
  const idea = page.locator(".idea-item", { hasText: text });
  await expect(idea).toBeVisible({ timeout: 30_000 });

  const style = await ghostStyleOf(page, idea, page.locator(".idea-item.dragging"));
  expect(isTransparent(style.bg), `место взятой мысли залито ${style.bg}`).toBe(true);
  expect(isTransparent(style.border), `у места взятой мысли осталась рамка ${style.border}`).toBe(true);
});

// 14.10.2026: «когда перетаскиваешь мысль для создания на основании неё
// задачу в поле колонок новая или в работе, она отбивается назад, а надо
// чтобы выводило окно создания задачи». Проверяется и сам столбец, и
// тёмное поле под ним — причина была во втором (см. withColumnBelow в
// dnd/TrackerDnd.tsx).
test("мысль, брошенная в столбец задач, открывает новую задачу", async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now().toString(36);

  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });
  await page.setViewportSize({ width: 1600, height: 1000 });

  const texts = [`E2E мысль в столбец ${stamp}`, `E2E мысль на карточку ${stamp}`];
  const { error } = await admin.from("ideas").insert(
    texts.map((text, i) => ({ id: `drop-idea-${stamp}-${i}`, user_id: userId, text, important: false, done: false })),
  );
  expect(error).toBeNull();
  await page.reload();
  await expect(page.locator(".idea-item", { hasText: texts[1] })).toBeVisible({ timeout: 30_000 });

  const targets = [
    page.locator("#col-new .task-column-body"),
    page.locator("#col-work .task-column-body"),
  ];
  for (const [i, text] of texts.entries()) {
    const idea = page.locator(".idea-item", { hasText: text });
    await centerOnScreen(idea);
    const from = (await idea.boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + from.height / 2 + 20, { steps: 5 });
    // Первая — в сам столбец, вторая — НИЖЕ его последней карточки: туда,
    // где на снимке Кирилла она и отскакивала (столбец кончается там, где
    // кончаются карточки, а тёмное поле под ним глаз считает тем же
    // столбцом).
    const to = (await targets[i].boundingBox())!;
    const y = i === 0 ? to.y + Math.min(60, to.height / 2) : to.y + to.height + 120;
    await page.mouse.move(to.x + to.width / 2, y, { steps: 15 });
    await page.mouse.up();

    await expect(page.locator("#fTitle")).toHaveValue(text, { timeout: 5_000 });
    // Закрытие повторяется: однажды (14.10.2026, общий прогон, 1 из 7)
    // первое нажатие × сразу после броска не закрыло окно — похоже на
    // нажатие, которое dnd-kit гасит как хвост только что кончившегося
    // переноса. Проверяется здесь перенос, а не крестик.
    await expect(async () => {
      await page.click("#cancelBtn", { timeout: 1_000 });
      await expect(page.locator("#fTitle")).toHaveCount(0, { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
  }
});
