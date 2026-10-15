// Повтор «в рабочий день»: ежемесячная или ежегодная задача, чьё число
// выпало на выходной, встаёт на ближайший рабочий день после него.
//
// Предложение Михаила Котова 15.10.2026: «ставишь на 1-е число и в какой-то
// месяц выпадет на сб. или вс. … задача встанет на 2-е число, если 1-е это
// воскресенье» (точнее — на понедельник: суббота и воскресенье оба
// выходные). Миграция 0064, колонка `recur_workday`.
//
// Один расчёт на браузер (taskDisplay, местное время) и крон (taskLogic,
// московское время через UTC-геттеры): поэтому функции принимают голые
// год/месяц/число, а не Date, — каждый читает их своими геттерами.
//
// Выходные — суббота, воскресенье и неподвижные праздники РФ (1–8 января,
// 23 февраля, 8 марта, 1 и 9 мая, 12 июня, 4 ноября). Переносы выходных,
// которые правительство объявляет на каждый год, сюда не входят: точный
// календарь живёт в isdayoff.ru (lib/workCalendar), но тот — сетевой
// запрос, а этот расчёт идёт синхронно на каждую перерисовку доски. Цена
// приближения — редкий понедельник-перенос, на который задача всё же
// встанет; новогодние каникулы, где это важнее всего, учтены.

const FIXED_HOLIDAYS = new Set([
  "1-1", "1-2", "1-3", "1-4", "1-5", "1-6", "1-7", "1-8",
  "2-23", "3-8", "5-1", "5-9", "6-12", "11-4",
]);

// Месяц здесь и дальше — с нуля, как у Date.
export function isDayOff(y: number, m0: number, d: number): boolean {
  const wd = new Date(Date.UTC(y, m0, d)).getUTCDay();
  if (wd === 0 || wd === 6) return true;
  return FIXED_HOLIDAYS.has(`${m0 + 1}-${d}`);
}

type Ymd = { y: number; m0: number; d: number };

function fromUtc(t: number): Ymd {
  const x = new Date(t);
  return { y: x.getUTCFullYear(), m0: x.getUTCMonth(), d: x.getUTCDate() };
}

// Куда встаёт число `day` месяца (y, m0). null — такого числа в месяце нет
// (31-е в феврале): повтор в этот месяц не срабатывает, как и без галочки.
export function shiftedOccurrence(y: number, m0: number, day: number, workday: boolean): Ymd | null {
  const t = Date.UTC(y, m0, day);
  const nominal = fromUtc(t);
  if (nominal.d !== day) return null;
  if (!workday) return nominal;
  let cur = nominal;
  // Самая длинная цепочка выходных — новогодние каникулы с выходными по
  // краям, меньше двух недель; предел — страховка от бесконечного цикла.
  for (let i = 0; i < 20 && isDayOff(cur.y, cur.m0, cur.d); i++) {
    cur = fromUtc(Date.UTC(cur.y, cur.m0, cur.d + 1));
  }
  return cur;
}

const same = (a: Ymd | null, y: number, m0: number, d: number) => !!a && a.y === y && a.m0 === m0 && a.d === d;

// Выпадает ли ежемесячная задача на этот день. Перенос может перейти в
// следующий месяц (31-е в субботу → 2-е), поэтому спрашиваются и этот
// месяц, и прошлый.
export function monthlyHits(y: number, m0: number, d: number, day: number, workday: boolean): boolean {
  if (!day) return false;
  if (!workday) return d === day;
  if (same(shiftedOccurrence(y, m0, day, true), y, m0, d)) return true;
  const prev = fromUtc(Date.UTC(y, m0 - 1, 1));
  return same(shiftedOccurrence(prev.y, prev.m0, day, true), y, m0, d);
}

// То же для ежегодной: перенос с 31 декабря уходит в январь следующего
// года, поэтому спрашиваются этот год и прошлый.
export function yearlyHits(y: number, m0: number, d: number, day: number, month0: number, workday: boolean): boolean {
  if (!day || month0 < 0) return false;
  if (!workday) return d === day && m0 === month0;
  if (same(shiftedOccurrence(y, month0, day, true), y, m0, d)) return true;
  return same(shiftedOccurrence(y - 1, month0, day, true), y, m0, d);
}
