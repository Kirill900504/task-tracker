// Когда — одним ответом на весь проект.
//
// Дни и их названия жили в двух файлах сразу: `isoDate`/`addDays` в
// quickAdd (там их зовёт подсказка модели), `resolveWhen` в meetingNotes
// (её зовут массовый перенос и разбор надиктованного). Пока разбор фразы
// не начал проверять СВОЙ срок, это никому не мешало — а как только
// начал, импортировать пришлось бы по кругу: quickAdd → meetingNotes →
// quickAdd. Круг здесь не «некрасиво», а первый шаг к третьей копии тех
// же семи дней недели, поэтому дни переехали сюда, в место без единой
// зависимости.

export const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

// «Завтра», «послезавтра», «через неделю» — это рабочие дни.
//
// 13.10.2026, слова Кирилла: «при нажатии „завтра“, например, в пятницу…
// задача или встреча ставилась автоматически на понедельник, а не на
// субботу или воскресенье». Суббота и воскресенье — выходные, и срок,
// упавший на них, никто не увидит до понедельника, а ступени просрочки
// начнут считать с субботы. Поэтому день, выпавший на выходной, едет на
// ближайший понедельник. «Сегодня» (ноль дней) не трогается: сегодня —
// это сегодня, даже в субботу. Названный день недели тоже не трогается —
// «к субботе» сказано нарочно. Праздники не учитываются: календаря
// праздников в трекере нет, а выдуманный был бы хуже отсутствующего.
export function workdayIn(now: Date, days: number): Date {
  const d = addDays(now, days);
  if (days === 0) return d;
  const dow = d.getDay();
  if (dow === 6) return addDays(d, 2);
  if (dow === 0) return addDays(d, 1);
  return d;
}

// Сегодняшний день ПО МОСКВЕ, обычной локальной датой.
//
// Считает это не Vercel, где `new Date()` — это UTC: с полуночи до трёх
// ночи по Москве «сегодня» там ещё вчера, и задача, надиктованная поздно
// вечером, заводилась вчерашним числом, то есть сразу просроченной.
// Формат ответа — Date с ЛОКАЛЬНЫМИ полями, потому что именно их читают
// isoDate и addDays; тот же приём, что в bulkActions.
export function moscowToday(): Date {
  const parts = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" }).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

// A label the model is allowed to say ("friday", "tomorrow") turned into a
// real date here, in code. The model is never asked to do the arithmetic —
// see the note at the top of quickAdd.ts for what happens when it is.
export function resolveWhen(when: string, now: Date): string {
  const key = String(when || "").trim().toLowerCase();
  if (!key || key === "none") return "";
  if (key === "today") return isoDate(now);
  if (key === "tomorrow") return isoDate(workdayIn(now, 1));
  if (key === "day_after") return isoDate(workdayIn(now, 2));
  if (key === "next_week") return isoDate(workdayIn(now, 7));
  // "На этой неделе" without a day named: the end of the working week is the
  // most useful reading of it, and never a date already in the past.
  if (key === "this_week") {
    const daysToFriday = (5 - now.getDay() + 7) % 7;
    return isoDate(addDays(now, daysToFriday));
  }
  const target = WEEKDAY_INDEX[key];
  if (target === undefined) return "";
  // The next occurrence of that weekday, today included (a Monday task said
  // to be "к понедельнику" on a Monday means today, not a week out).
  const delta = (target - now.getDay() + 7) % 7;
  return isoDate(addDays(now, delta));
}

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// Срок, пришедший от модели, — это ДАТА или ничего.
//
// 21.09.2026 бот ответил «Срок: undefined.undefined.today»: модель
// положила в deadline слово «today» из соседнего словаря (он есть у
// массового переноса), а дальше это слово прошло НАСКВОЗЬ — печать даты
// разобрала его на три части и напечатала две пустые, а Postgres принял
// его молча, потому что 'today' для него законное значение типа date
// наравне с 'now' и 'yesterday'. То есть ошибка была видна только в
// тексте ответа, а в базу при этом легла дата, которую никто не называл.
//
// Отсюда правило: всё, что не YYYY-MM-DD, сначала пробуется как ярлык
// («today», «friday»), а не разобравшись — выбрасывается. Пустой срок
// честнее выдуманного: задачу без срока видно в списке, задачу с чужим
// сроком — нет.
export function normalizeDeadline(value: unknown, now: Date): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  if (ISO_SHAPE.test(raw)) {
    // Форма ещё не значит существование: «2026-02-31» разбирается в 3
    // марта, и такой срок был бы не тем, что назвали.
    const [y, m, d] = raw.split("-").map(Number);
    const parsed = new Date(y, m - 1, d);
    return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d ? raw : "";
  }
  return resolveWhen(raw, now);
}
