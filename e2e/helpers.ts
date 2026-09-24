import { expect, type Locator, type Page } from "@playwright/test";

// Общие шаги для обоих наборов — настольного и телефонного.
//
// Отдельный файл, а не экспорт из tracker.spec.ts: Playwright запрещает
// одному файлу с тестами импортировать другой (он тогда собирался бы дважды
// и тесты выполнялись бы по два раза).

// Исполнитель обязателен — без него форма задачи не сохраняется вовсе
// (см. save() в TaskModal). Поэтому каждый тест, который заводит задачу,
// сначала ставит на неё человека; раньше этого шага не было, потому что и
// правила не было.
//
// Берётся первый попавшийся человек: кто именно — этим тестам безразлично,
// а список у свежего тестового аккаунта заполняется значениями по умолчанию
// (DEFAULT_ASSIGNEES) и заранее не известен. Список читается отдельным
// запросом и приезжает чуть позже формы, отсюда щедрое ожидание.
export async function pickAnyExecutor(page: Page) {
  // :not(.chip-add) обязателен. «+ человек» — такой же .participant-chip, и
  // он стоит в сетке ОДИН, пока список людей ещё едет из базы: без этого
  // уточнения .first() попадал именно в него, и вместо меню ролей
  // открывалось окно «Новый человек».
  const chip = page.locator("#fPeople .participant-chip:not(.chip-add)").first();
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await chip.click();
  // Роль спрашивается меню у самой кнопки; на телефоне то же меню —
  // полоса у нижнего края (см. ActionMenu).
  const menu = page.locator(".export-menu, .action-sheet").first();
  await expect(menu).toBeVisible();
  // Якорь на начало строки обязателен: hasText со строкой ищет ПОДСТРОКУ и
  // без учёта регистра, а «Соисполнитель — помогает» содержит «исполнитель»
  // и попадает под тот же фильтр.
  await menu.locator(".export-item").filter({ hasText: /^Исполнитель/ }).click();
  await expect(chip).toHaveClass(/role-executor/);
}


// Поставить задачу САМОМУ СЕБЕ — строка со скобками «(я)» в списке людей.
//
// Нужно там, где проверяется не участие, а что-то другое: запись в базу,
// повтор, синхронизация. С 20.09.2026 галочка на задаче, поручённой
// другому человеку, спрашивает результат и уходит через приёмку — это
// правильно для работы и лишний шаг для теста, которому важно ровно
// «нажал и закрылось».
export async function pickSelfExecutor(page: Page) {
  // Метка «(я)» с экрана убрана 24.09.2026 (Кирилл: «убери это дурацкое
  // (я)»), поэтому свою строку теперь находят по data-self, а не по тексту.
  const chip = page.locator('#fPeople .participant-chip[data-self="true"]').first();
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await chip.click();
  const menu = page.locator(".export-menu, .action-sheet").first();
  await expect(menu).toBeVisible();
  await menu.locator(".export-item").filter({ hasText: /^Исполнитель/ }).click();
  await expect(chip).toHaveClass(/role-executor/);
}

// Перетаскивание — настоящими движениями мыши.
//
// dnd-kit слушает pointer-события, поэтому подделывать DragEvent больше не
// нужно и нельзя: перенос начинается только после того, как указатель
// сдвинулся на несколько пикселей с зажатой кнопкой (порог в TrackerDnd —
// он же отличает «нажал» от «потянул»). Отсюда три шага вместо одного:
// маленький сдвиг на месте, чтобы перетаскивание вообще началось, потом
// движение к цели, и только потом отпускание. Паузы — чтобы React успел
// перерисовать расступившиеся списки: без них отпускание приходит в тот
// момент, когда цель ещё не знает, что над ней что-то висит.
export async function dragOnto(page: Page, source: Locator, target: Locator) {
  // Мышь не может взять то, чего нет на экране: boundingBox отдаёт
  // координаты и для элемента ниже сгиба, а движение туда просто не
  // попадёт ни во что. Человек в этом месте сначала прокручивает.
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  if (!from) throw new Error('не найден источник перетаскивания');

  await page.mouse.move(from.x + Math.min(40, from.width / 2), from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + Math.min(40, from.width / 2) + 12, from.y + from.height / 2 + 8, { steps: 5 });
  await page.waitForTimeout(150);

  // Координаты цели берутся ПОСЛЕ начала перетаскивания, а не до: страница
  // к этому моменту могла проехать (у dnd-kit есть автопрокрутка у краёв),
  // и прямоугольник, измеренный заранее, указывает в пустоту. Именно на
  // этом тест «мысль на день календаря» и падал молча.
  const to = await target.boundingBox();
  if (!to) throw new Error('не найдена цель перетаскивания');

  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.waitForTimeout(250);
  await page.mouse.up();
}

// Клетка календаря по числу месяца — только текущего, соседние месяцы
// показывают те же числа.
export function dayCell(page: Page, day: number): Locator {
  return page.locator(`.cal-day:not(.other-month):text-is("${day}")`).first();
}

// Дождаться, пока элемент перестанет ездить, и отдать его прямоугольник.
//
// Нужно там, где по элементу СНАЧАЛА жмут, а потом ведут мышь: между
// замером и нажатием страница живёт своей жизнью — приезжают задачи,
// растут столбцы, появляется полоса «Загрузка», — и кнопка успевает
// съехать на десяток пикселей вниз. Нажатие тогда приходится мимо,
// перетаскивание не начинается вовсе, а тест сообщает, что порядок не
// изменился: правда, но не та, которую он проверял. В одиночном прогоне
// этого почти не бывает (страница пустая), в общем — бывает постоянно,
// и выглядит как случайность.
//
// Playwright умеет ждать «стабильности» сам, но только внутри своих
// действий (click, hover): между двумя нашими вызовами эта гарантия не
// живёт. Поэтому ждём явно — два одинаковых замера подряд.
export async function settled(locator: Locator, tries = 20): Promise<{ x: number; y: number; width: number; height: number }> {
  let prev = await locator.boundingBox();
  for (let i = 0; i < tries; i++) {
    await locator.page().waitForTimeout(100);
    const now = await locator.boundingBox();
    if (!now) throw new Error('элемент исчез, пока ждали, когда он остановится');
    if (prev && Math.abs(prev.x - now.x) < 1 && Math.abs(prev.y - now.y) < 1) return now;
    prev = now;
  }
  throw new Error('элемент так и не перестал двигаться');
}

// Выйти — на компьютере. Отдельный `#signOutBtn` исчез 23.09.2026 вместе с
// «личным кабинетом» в шапке (кнопка с именем открывает меню, и «Выйти» —
// один из его пунктов, как «Команда» и подключение мессенджера). Три места
// звали старую кнопку напрямую по id и молча упёрлись в её исчезновение —
// с этого момента про выход знает только этот хелпер.
export async function signOut(page: Page) {
  await page.click("#accountBtn");
  await page.locator(".export-item", { hasText: "Выйти" }).click();
}
