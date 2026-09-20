// Встреча как отрезок времени: кто когда занят и когда она кончится.
//
// Раньше встреча была точкой — «12:00», — и этого хватало, пока никто не
// спрашивал «а свободен ли он». Как только участников стало четырнадцать,
// вопрос стал главным: назначая планёрку на 12:00, человек обязан видеть,
// что у Есиной в это время уже встреча, ДО того как её позовёт.
//
// Здесь только арифметика, без базы: её легко проверить целиком, а
// ошибка в ней стоит дорого — занятый слот, показанный свободным, это
// два приглашения на одно время.

export type Slot = { start: number; end: number };

// Длительности, между которыми выбирают. Две, и это решение: «сколько
// угодно минут» превращает одно нажатие в поле ввода, а сетка времени всё
// равно идёт получасом.
export const DURATIONS = [30, 60] as const;
export type Duration = (typeof DURATIONS)[number];

export function normalizeDuration(value: unknown): Duration {
  return Number(value) === 60 ? 60 : 30;
}

// «14:30» → 870. Пустое и кривое — null: встреча без времени занятости не
// создаёт, и молча считать её полуночной было бы хуже.
export function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((time || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function timeOf(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function slotOf(time: string, duration: unknown): Slot | null {
  const start = minutesOf(time);
  if (start === null) return null;
  return { start, end: start + normalizeDuration(duration) };
}

// Пересекаются ли два отрезка. Касание концами — не пересечение: встреча
// с 12:00 до 12:30 и встреча в 12:30 идут подряд, и запрещать это значит
// запрещать обычный день.
export function overlaps(a: Slot, b: Slot): boolean {
  return a.start < b.end && b.start < a.end;
}

// Занятые получасовки. Сетка выбора времени состоит из них, и ответ ей
// нужен именно такой: какие кнопки гасить.
export function busyStarts(slots: Slot[], step = 30): number[] {
  const out = new Set<number>();
  for (const slot of slots) {
    for (let t = slot.start; t < slot.end; t += step) out.add(t - (t % step));
  }
  return [...out].sort((x, y) => x - y);
}

// Когда предупредить, что время кончается, и когда сказать, что кончилось.
//
// Просьба Кирилла: «если встреча была назначена на 1 час, а он уже
// прошёл, люди не продолжали собрание, а шли работать». Предупреждение —
// за десять минут у часовой и за пять у получасовой: доля одна и та же,
// а пять минут до конца часовой встречи никого не успевают сдвинуть.
export function warnBefore(duration: unknown): number {
  return normalizeDuration(duration) === 60 ? 10 : 5;
}

export function endsAt(time: string, duration: unknown): string {
  const start = minutesOf(time);
  if (start === null) return "";
  return timeOf(start + normalizeDuration(duration));
}
