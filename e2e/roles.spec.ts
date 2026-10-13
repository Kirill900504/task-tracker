import { test, expect, type Locator } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";

// Вид кубика на доске должен быть ВИДЕН, а не только проставлен.
//
// 21.09.2026 Кирилл завёл задачу на себя и сказал: «никаких признаков
// отличия там где я соисполнитель и наблюдатель». Разметка при этом была
// верной — класс стоял на карточке, — и ни один тест не врал: они все
// проверяют КЛАСС. Невидимой была разница цветов. Поэтому здесь
// спрашивается у браузера то, что видит глаз: вычисленные цвета карточек
// рядом друг с другом.
//
// 13.10.2026 правило вида поменялось (lib/taskCardKind): красит не моя
// роль, а ОТНОШЕНИЕ задачи ко мне — «моё поручение другим» фирменным,
// «моя личная» спокойным тёплым, «поручили мне» лавандовым, «помогаю» и
// «смотрю» — без заливки, тише всех. Прежняя заливка «я исполнитель»
// доставалась в первую очередь задачам самому себе, а поручения другим
// стояли серыми — ровно наоборот тому, что нужно постановщику.

const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function roleBar(card: Locator): Promise<string> {
  return card.locator(".task-role-bar").evaluate((el) => getComputedStyle(el).backgroundColor);
}
const background = (card: Locator) => card.evaluate((el) => getComputedStyle(el).backgroundColor);

test("моё поручение, моя личная, поручили мне, помогаю, смотрю — пять разных видов", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);

  // Чужое авторство нужно настоящее: «поручили мне» — это created_by
  // другого человека. Временный постановщик удаляется в конце.
  const { data: helper, error: helperError } = await admin.auth.admin.createUser({
    email: `e2e-kind-${stamp}@example.invalid`,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (helperError || !helper.user) throw helperError;
  const otherAuthor = helper.user.id;

  try {
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });

    // Своя строка в списке людей появляется при первом открытии трекера,
    // поэтому спрашивается она ПОСЛЕ входа.
    let list: { id: string; name: string }[] = [];
    await expect
      .poll(async () => {
        const { data } = await admin.from("assignees").select("id, name").eq("user_id", userId);
        list = (data || []) as { id: string; name: string }[];
        return list.some((p) => p.name.includes("(я)")) && list.some((p) => !p.name.includes("(я)"));
      }, { timeout: 20_000 })
      .toBe(true);
    const me = list.find((p) => p.name.includes("(я)"))!;
    const other = list.find((p) => !p.name.includes("(я)"))!;

    const plan = {
      self: { author: null, deadline: null },
      outgoing: { author: null, deadline: null },
      incoming: { author: otherAuthor, deadline: null },
      co: { author: otherAuthor, deadline: null },
      watch: { author: otherAuthor, deadline: null },
      lateMine: { author: otherAuthor, deadline: "2020-01-01" },
      lateOut: { author: null, deadline: "2020-01-01" },
    } as const;
    type Key = keyof typeof plan;
    const keys = Object.keys(plan) as Key[];
    const ids = Object.fromEntries(keys.map((k) => [k, `kind-${k}-${stamp}`])) as Record<Key, string>;

    // Все объекты одной вставки несут ОДИН набор ключей (CLAUDE.md:
    // PostgREST не подставляет умолчание в пачке).
    const { error: taskError } = await admin.from("tasks").insert(
      keys.map((k) => ({
        id: ids[k],
        user_id: userId,
        created_by: plan[k].author,
        title: `E2E вид ${k} ${stamp}`,
        // Пусто нарочно: имя в поле заставило бы триггер 0024 завести
        // строку участия самому, и роль была бы не та.
        assignee: "",
        status: "in_progress",
        deadline: plan[k].deadline,
      })),
    );
    expect(taskError).toBeNull();

    const { error: partError } = await admin.from("task_participants").insert([
      { user_id: userId, task_id: ids.self, assignee_id: me.id, role: "executor" },
      { user_id: userId, task_id: ids.outgoing, assignee_id: other.id, role: "executor" },
      { user_id: userId, task_id: ids.incoming, assignee_id: me.id, role: "executor" },
      { user_id: userId, task_id: ids.co, assignee_id: other.id, role: "executor" },
      { user_id: userId, task_id: ids.co, assignee_id: me.id, role: "coexecutor" },
      { user_id: userId, task_id: ids.watch, assignee_id: other.id, role: "executor" },
      { user_id: userId, task_id: ids.watch, assignee_id: me.id, role: "watcher" },
      { user_id: userId, task_id: ids.lateMine, assignee_id: me.id, role: "executor" },
      { user_id: userId, task_id: ids.lateOut, assignee_id: other.id, role: "executor" },
    ]);
    expect(partError).toBeNull();

    await page.reload();
    const card = (k: Key) => page.locator(`.task[data-id="${ids[k]}"]`);
    for (const k of keys) await expect(card(k)).toBeVisible({ timeout: 30_000 });
    // Вид приезжает вторым запросом (строки участия живут вне движка
    // синхронизации) — сперва дожидаемся его.
    for (const k of ["self", "outgoing", "incoming", "co", "watch"] as const) {
      await expect(card(k)).toHaveAttribute("data-kind", k, { timeout: 30_000 });
    }

    // Пять разных корешков: «сколько меня в этой задаче и чья она».
    const bars = await Promise.all((["self", "outgoing", "incoming", "co", "watch"] as const).map((k) => roleBar(card(k))));
    expect(new Set(bars).size, `цвета корешка совпали: ${JSON.stringify(bars)}`).toBe(5);

    // Фон: свой тон у трёх видов — мои поручения, моя личная, поручили
    // мне; «помогаю» и «смотрю» — обычной карточкой, одинаково.
    const [bgSelf, bgOut, bgIn, bgCo, bgWatch] = await Promise.all(
      (["self", "outgoing", "incoming", "co", "watch"] as const).map((k) => background(card(k))),
    );
    expect(bgCo, "у «помогаю» и «смотрю» фон должен совпадать").toBe(bgWatch);
    expect(new Set([bgSelf, bgOut, bgIn, bgCo]).size, `фоны совпали: ${JSON.stringify({ bgSelf, bgOut, bgIn, bgCo })}`).toBe(4);

    // Наблюдатель и соисполнитель — значком в углу, а не цветом.
    await expect(card("watch").locator(".kind-mark")).toBeVisible();
    await expect(card("co").locator(".kind-mark")).toBeVisible();
    // Своя — подписью «Личная задача» вместо стрелки от себя к себе.
    await expect(card("self").locator(".task-self-tag")).toBeVisible();

    // Просрочка — два разных сигнала (выбор Кирилла 21.09.2026). Своё
    // горящее (я исполнитель) краснеет целиком; моё поручение другому —
    // только корешком, а фон остаётся фирменным.
    await expect(card("lateMine")).toHaveClass(/overdue/, { timeout: 30_000 });
    await expect(card("lateOut")).not.toHaveClass(/overdue/);
    expect(await background(card("lateOut"))).toBe(bgOut);
    expect(await roleBar(card("lateOut"))).not.toBe(bars[1]);
    // Срок пилюлей словами — красной у всех, кому он виден.
    await expect(card("lateOut").locator(".task-due-pill.tone-late")).toBeVisible();

    await admin.from("tasks").delete().in("id", Object.values(ids));
  } finally {
    await admin.auth.admin.deleteUser(otherAuthor);
  }
});
