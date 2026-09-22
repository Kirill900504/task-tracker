import { test, expect, type Locator } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { userFilePath } from "./userFile";

// Роль на доске должна быть ВИДНА, а не только проставлена.
//
// 21.09.2026 Кирилл завёл задачу на себя и сказал: «никаких признаков
// отличия там где я соисполнитель и наблюдатель». Разметка при этом была
// верной — класс role-coexecutor стоял на карточке, — и ни один тест не
// врал: они все проверяют КЛАСС. Невидимой была разница цветов
// (соисполнителю доставалась рамка того же цвета, что у обычной карточки,
// а наблюдателю светлый фон гасила прозрачность).
//
// Поэтому здесь спрашивается у браузера то, что видит глаз: настоящий
// вычисленный фон четырёх карточек рядом друг с другом. Юнит-тест на
// переменные (src/lib/roleTones.test.ts) считает то же самое по файлу
// стилей — он быстрее и точнее, но не знает, доехало ли правило до
// страницы и не перекрыл ли его кто-то сверху.

const { id: userId, email, password } = JSON.parse(readFileSync(userFilePath(), "utf8"));

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Цвет корешка — полоски у левого края, которой карточка называет мою
// роль. Спрашивается настоящий вычисленный цвет, а не класс: класс стоял
// и в тот раз, когда «никаких признаков отличия» не было.
async function roleBar(card: Locator): Promise<string> {
  return card.locator(".task-role-bar").evaluate((el) => getComputedStyle(el).backgroundColor);
}

test("исполнитель, соисполнитель и наблюдатель — три разных тона карточки", async ({ page }) => {
  const stamp = Date.now().toString(36);

  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await expect(page.locator("#newTaskBtn")).toBeVisible({ timeout: 30_000 });

  // Своя строка в списке людей появляется при первом открытии трекера
  // (список засевается значениями по умолчанию), поэтому спрашивается она
  // ПОСЛЕ входа, а не в beforeAll.
  const { data: people } = await admin.from("assignees").select("id, name").eq("user_id", userId);
  const list = (people || []) as { id: string; name: string }[];
  const me = list.find((p) => p.name.includes("(я)"));
  const other = list.find((p) => !p.name.includes("(я)"));
  expect(me, "в списке людей нет своей строки «(я)»").toBeTruthy();
  expect(other, "в списке людей некому быть чужим исполнителем").toBeTruthy();

  const titles = {
    executor: `E2E роль исполнитель ${stamp}`,
    coexecutor: `E2E роль соисполнитель ${stamp}`,
    watcher: `E2E роль наблюдатель ${stamp}`,
    none: `E2E роль чужая ${stamp}`,
    lateMine: `E2E просрочено моё ${stamp}`,
    lateOther: `E2E просрочено чужое ${stamp}`,
  };
  const ids = Object.fromEntries(Object.keys(titles).map((key) => [key, `role-${key}-${stamp}`])) as Record<
    keyof typeof titles,
    string
  >;

  // Все объекты одной вставки несут ОДИН набор ключей: PostgREST не
  // подставляет умолчание колонке, которой нет у соседней строки в том же
  // массиве (CLAUDE.md), и вся вставка падает на not null.
  const { error: taskError } = await admin.from("tasks").insert(
    (Object.keys(titles) as (keyof typeof titles)[]).map((key) => ({
      id: ids[key],
      user_id: userId,
      title: titles[key],
      // Пусто нарочно: имя настоящего человека в этом поле заставило бы
      // триггер миграции 0024 завести строку участия самому, и роль
      // оказалась бы не та, которую ставит тест.
      assignee: "",
      status: "in_progress",
      // Срок ставится только двум последним: остальные проверяют роль, а
      // просроченная карточка меняет ещё и фон.
      deadline: key.startsWith("late") ? "2020-01-01" : null,
    })),
  );
  expect(taskError).toBeNull();

  const { error: partError } = await admin.from("task_participants").insert([
    { user_id: userId, task_id: ids.executor, assignee_id: me!.id, role: "executor" },
    { user_id: userId, task_id: ids.coexecutor, assignee_id: me!.id, role: "coexecutor" },
    { user_id: userId, task_id: ids.watcher, assignee_id: me!.id, role: "watcher" },
    { user_id: userId, task_id: ids.none, assignee_id: other!.id, role: "executor" },
    { user_id: userId, task_id: ids.lateMine, assignee_id: me!.id, role: "executor" },
    { user_id: userId, task_id: ids.lateOther, assignee_id: other!.id, role: "executor" },
  ]);
  expect(partError).toBeNull();

  await page.reload();
  const cards = {
    executor: page.locator(`.task[data-id="${ids.executor}"]`),
    coexecutor: page.locator(`.task[data-id="${ids.coexecutor}"]`),
    watcher: page.locator(`.task[data-id="${ids.watcher}"]`),
    none: page.locator(`.task[data-id="${ids.none}"]`),
  };
  for (const card of Object.values(cards)) await expect(card).toBeVisible({ timeout: 30_000 });
  // Роль приезжает вторым запросом (строки участия живут вне движка
  // синхронизации), поэтому сперва дожидаемся, пока она доедет.
  await expect(cards.watcher).toHaveAttribute("data-role", "watcher", { timeout: 30_000 });
  await expect(cards.coexecutor).toHaveAttribute("data-role", "coexecutor");
  await expect(cards.executor).toHaveAttribute("data-role", "executor");
  await expect(cards.none).toHaveAttribute("data-role", "none");

  const tones = {
    executor: await roleBar(cards.executor),
    coexecutor: await roleBar(cards.coexecutor),
    watcher: await roleBar(cards.watcher),
    none: await roleBar(cards.none),
  };
  // Четыре разных ответа на «сколько меня в этой задаче». Сравниваются
  // именно они, а не соответствие конкретному цвету: палитру можно
  // менять, нельзя — сливать роли в один тон.
  expect(new Set(Object.values(tones)).size, `цвета корешка совпали: ${JSON.stringify(tones)}`).toBe(4);

  // Фон трогает РОВНО одна роль — исполнитель (слова Кирилла 22.09.2026:
  // «исполнителю верни выделение в фирменном цвете как раньше»). Своя
  // работа ищется глазами через всю доску, и полоска для этого слабовата.
  // Остальные три фона обязаны совпадать: заливка, потраченная на
  // «помогаю» и «смотрю», вернула бы три близких фона, которые
  // приходится сравнивать.
  const background = (card: Locator) => card.evaluate((el) => getComputedStyle(el).backgroundColor);
  const plain = await Promise.all([background(cards.coexecutor), background(cards.watcher), background(cards.none)]);
  expect(new Set(plain).size, `фон разошёлся у ролей без заливки: ${JSON.stringify(plain)}`).toBe(1);
  expect(await background(cards.executor), "исполнителю положена фирменная заливка").not.toBe(plain[0]);

  // Просрочка — два разных сигнала, и путать их нельзя (выбор Кирилла
  // 21.09.2026). Своё горящее краснеет целиком: работа на мне. Горящее,
  // которое я поручил другому, краснеет только корешком — доска при
  // четырнадцати людях иначе краснеет вся и перестаёт что-либо значить.
  const lateMine = page.locator(`.task[data-id="${ids.lateMine}"]`);
  const lateOther = page.locator(`.task[data-id="${ids.lateOther}"]`);
  await expect(lateMine).toHaveClass(/overdue/, { timeout: 30_000 });
  await expect(lateOther).not.toHaveClass(/overdue/);
  expect(await background(lateOther)).toBe(plain[0]);
  // …но и не молчит: её корешок не тот, что у обычной чужой задачи, и не
  // тот, что у моей работы.
  const lateOtherBar = await roleBar(lateOther);
  expect(lateOtherBar).not.toBe(tones.none);
  expect(lateOtherBar).not.toBe(tones.executor);

  await admin.from("tasks").delete().in("id", Object.values(ids));
});
