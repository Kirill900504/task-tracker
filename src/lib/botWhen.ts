// «Когда» из живой фразы — для переноса встречи или срока из мессенджера.
//
// 19.10.2026 Кирилл четыре раза подряд попросил бота перенести одну
// встречу: «на следующий понедельник», «на 26.10», «перенести на 26
// октября», «26.10» — и четыре раза получил «не понял, на какой день».
// Массовый перенос умел только слова-ярлыки («monday», «tomorrow»), а
// число не понимал вовсе: модель обязана была перевести «26.10» в ярлык,
// которого для числа нет.
//
// Поэтому дату считает КОД, а не модель — то же правило, что во всём
// проекте («модель не делает арифметику»): модель только говорит, что
// это перенос и чего, а «когда» вычитывается здесь из самих слов человека.
// Чистая функция без сети и без часов: сегодня и исходную дату ей
// передают, и поэтому её можно проверить тестом на любой день.

export type When = {
  // YYYY-MM-DD. Пусто — дату не назвали.
  date: string;
  // HH:MM. Пусто — время не назвали.
  time: string;
  // «В то же время», «на это же время» — время оставить прежним явно.
  sameTime: boolean;
};

const MONTHS: [RegExp, number][] = [
  [/^янв/, 1],
  [/^фев/, 2],
  [/^мар/, 3],
  [/^апр/, 4],
  [/^ма[йя]/, 5],
  [/^июн/, 6],
  [/^июл/, 7],
  [/^авг/, 8],
  [/^сен/, 9],
  [/^окт/, 10],
  [/^ноя/, 11],
  [/^дек/, 12],
];

// Основы дней недели: «понедельник», «в понедельник», «на понедельник»,
// «к понедельнику», «понедельника». Индекс — как у Date.getDay().
const WEEKDAY_STEMS: [RegExp, number][] = [
  [/понедельн/, 1],
  [/вторн/, 2],
  [/(?<![а-я])сред[уаы]?(?![а-я])/, 3],
  [/четверг/, 4],
  [/пятниц/, 5],
  [/суббот/, 6],
  [/воскресен/, 0],
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseIso(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function shift(value: string, days: number): string {
  const d = parseIso(value);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function realDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

// День и месяц без года — ближайший такой день, не в прошлом. «26.10»,
// сказанное в декабре, — это октябрь следующего года, а не вчерашний год.
function nearest(today: string, m: number, d: number): string {
  const y = Number(today.slice(0, 4));
  if (!realDate(y, m, d)) return realDate(y + 1, m, d) ? iso(y + 1, m, d) : "";
  const candidate = iso(y, m, d);
  return candidate < today ? (realDate(y + 1, m, d) ? iso(y + 1, m, d) : "") : candidate;
}

function weekdayOf(value: string): number {
  return parseIso(value).getUTCDay();
}

// Ближайший такой день недели строго ПОСЛЕ сегодняшнего: «перенеси на
// вторник», сказанное во вторник, — это следующий вторник, переносить на
// сегодня через «вторник» не говорят.
function nextWeekday(today: string, target: number): string {
  const delta = (target - weekdayOf(today) + 7) % 7 || 7;
  return shift(today, delta);
}

const NUMBER_WORDS: Record<string, number> = {
  один: 1,
  одну: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
};

function count(word: string | undefined): number {
  if (!word) return 1;
  if (/^\d+$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? 1;
}

// `from` — дата самой встречи или срок задачи. Им меряется сдвиг «на
// неделю» и «на два дня»: «перенеси на неделю» встречу в четверг — это
// четверг через неделю, а не «через неделю от сегодня». Без `from` (нечего
// сдвигать) сдвиг считается от сегодня.
export function parseWhen(text: string, today: string, from = ""): When {
  const s = ` ${String(text || "").toLowerCase().replace(/ё/g, "е")} `;
  const out: When = { date: "", time: "", sameTime: /(то|это|тоже)\s*же\s+время|в\s+то\s+время|тоже\s+время|время\s+(то\s+же|прежнее|не\s+менять)/.test(s) };

  // --- время. Двоеточие — всегда время. Точка — время только после «в»
  // («в 10.30»): «10.11» без предлога — это дата.
  const colon = s.match(/(?:^|[^\d.])([01]?\d|2[0-3]):([0-5]\d)(?![\d])/);
  // Границы слова — явные: `\b` в JavaScript знает только латиницу, и
  // `\bзавтра\b` не находит «завтра» нигде.
  const dotted = s.match(/(?<![а-я])(?:в|на|к)\s+([01]?\d|2[0-3])\.([0-5]\d)(?![\d.])/);
  const hours = s.match(/(?<![а-я])(?:в|на|к)\s+([01]?\d|2[0-3])\s*(?:ч(?![а-я])|час)/);
  const timeHit = colon || dotted || hours;
  if (timeHit) out.time = `${pad(Number(timeHit[1]))}:${timeHit[2] && timeHit !== hours ? timeHit[2] : "00"}`;
  // Чтобы «15:30» не прочиталось ниже как дата 15.30.
  const rest = timeHit ? s.replace(timeHit[0], " ") : s;

  // --- дата числом: 26.10.2026, 26.10.26, 26.10, 26/10, 2026-10-26.
  const isoHit = rest.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoHit && realDate(Number(isoHit[1]), Number(isoHit[2]), Number(isoHit[3]))) {
    out.date = iso(Number(isoHit[1]), Number(isoHit[2]), Number(isoHit[3]));
    return out;
  }
  const num = rest.match(/(?:^|[^\d:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d:])/);
  if (num) {
    const d = Number(num[1]);
    const m = Number(num[2]);
    if (num[3]) {
      const y = num[3].length === 2 ? 2000 + Number(num[3]) : Number(num[3]);
      if (realDate(y, m, d)) {
        out.date = iso(y, m, d);
        return out;
      }
    } else {
      const date = nearest(today, m, d);
      if (date) {
        out.date = date;
        return out;
      }
    }
  }

  // --- «26 октября», «26-го октября».
  const worded = rest.match(/(?<!\d)(\d{1,2})(?:-?го|-?е)?\s+([а-я]+)/g) || [];
  for (const hit of worded) {
    const [, dRaw, word] = hit.match(/(\d{1,2})(?:-?го|-?е)?\s+([а-я]+)/) || [];
    const month = MONTHS.find(([re]) => re.test(word || ""))?.[1];
    if (!month) continue;
    const date = nearest(today, month, Number(dRaw));
    if (date) {
      out.date = date;
      return out;
    }
  }

  // --- «на 26-е», «26 числа» — этот месяц, а если уже прошло — следующий.
  const dayOnly = rest.match(/(?<![а-я])(?:на|к)\s+(\d{1,2})(?:-?го|-?е)(?![а-я])|(?<!\d)(\d{1,2})\s+числа/);
  if (dayOnly) {
    const d = Number(dayOnly[1] || dayOnly[2]);
    const [y, m] = today.split("-").map(Number);
    let date = realDate(y, m, d) ? iso(y, m, d) : "";
    if (!date || date <= today) {
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      date = realDate(ny, nm, d) ? iso(ny, nm, d) : "";
    }
    if (date) {
      out.date = date;
      return out;
    }
  }

  // --- слова.
  if (/(?<![а-я])послезавтра(?![а-я])/.test(rest)) {
    out.date = shift(today, 2);
    return out;
  }
  if (/(?<![а-я])завтра(?![а-я])/.test(rest)) {
    out.date = shift(today, 1);
    return out;
  }
  if (/(?<![а-я])сегодня(?![а-я])/.test(rest)) {
    out.date = today;
    return out;
  }

  // «через 3 дня», «через неделю», «через две недели» — от сегодня.
  const after = rest.match(/через\s+(\d+|[а-я]+)?\s*(дн|день|недел)/);
  if (after) {
    const n = count(after[1]);
    out.date = shift(today, after[2] === "недел" ? n * 7 : n);
    return out;
  }

  // День недели. Раньше «на неделю», потому что «на следующей неделе во
  // вторник» называет день, а не сдвиг.
  for (const [re, wd] of WEEKDAY_STEMS) {
    if (!re.test(rest)) continue;
    let date = nextWeekday(today, wd);
    // «Через понедельник» и «в понедельник через неделю» — ещё неделя.
    if (/через\s+(один\s+)?(понедельн|вторн|сред|четверг|пятниц|суббот|воскресен)|через\s+неделю/.test(rest)) date = shift(date, 7);
    out.date = date;
    return out;
  }

  // «на неделю», «на 2 дня», «на следующую неделю», «на следующей неделе» —
  // СДВИГ от прежней даты: переносят встречу, а не назначают новую.
  const by = rest.match(/(?<![а-я])на\s+(\d+|[а-я]+)?\s*(дн|день|недел)/) || (/следующ[а-я]*\s+недел/.test(rest) ? ["", "", "недел"] : null);
  if (by) {
    const n = by[1] && !/следующ/.test(by[1]) ? count(by[1]) : 1;
    const days = by[2] === "недел" ? n * 7 : n;
    // Сдвиг от прежней даты — пока он не уводит в прошлое: встречу, которая
    // не состоялась вчера, «на неделю» переносят на неделю от вчера, а
    // встречу месячной давности — от сегодня.
    const moved = shift(from || today, days);
    out.date = moved > today ? moved : shift(today, days);
    return out;
  }

  return out;
}

export function fmtWhen(date: string, time = ""): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}${time ? ", " + time : ""}`;
}

const SHORT_DAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

// Подпись кнопки: «пн 26.10». День недели нужен: «26.10» на кнопке
// заставляет считать, а «пн» отвечает на вопрос сразу.
export function dayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${SHORT_DAYS[weekdayOf(date)]} ${d}.${m}`;
}

// Дни, которые предлагаются кнопками при переносе: завтра, послезавтра,
// ближайший понедельник, «+неделя» от прежней даты. Выходные пропускаются
// (тот же довод, что у workdayIn: встреча или срок в субботу — это
// понедельник, о котором никто не знал). Без повторов и без прошлого.
export function moveChoices(today: string, from: string): { label: string; date: string }[] {
  const workday = (value: string): string => {
    const wd = weekdayOf(value);
    return wd === 6 ? shift(value, 2) : wd === 0 ? shift(value, 1) : value;
  };
  const base = from && from > today ? from : today;
  // Слово на кнопке — только когда оно правда: «Завтра» в пятницу ведёт на
  // понедельник, и подпись «Завтра · пн» читалась бы ошибкой.
  const raw: { word: string; date: string; literal: string }[] = [
    { word: "Завтра", date: workday(shift(today, 1)), literal: shift(today, 1) },
    { word: "Послезавтра", date: workday(shift(today, 2)), literal: shift(today, 2) },
    { word: "", date: nextWeekday(today, 1), literal: "" },
    { word: "+неделя", date: shift(base, 7), literal: shift(base, 7) },
  ];
  const seen = new Set<string>();
  const out: { label: string; date: string }[] = [];
  for (const choice of raw) {
    if (choice.date <= today || choice.date === from || seen.has(choice.date)) continue;
    seen.add(choice.date);
    const word = choice.word && choice.date === choice.literal ? choice.word + " · " : "";
    out.push({ label: word + dayLabel(choice.date), date: choice.date });
  }
  return out;
}
