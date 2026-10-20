// «Отложить до…» (миграция 0049): почему с доски уходит только у автора и
// почему колонкой на задаче — написано там.

import { isoDate, workdayIn } from "@/lib/whenDate";

export function isSnoozed(snoozedUntil: string | null | undefined, today: string): boolean {
  return !!snoozedUntil && snoozedUntil > today;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// «Завтра» и «через неделю» — рабочим днём (см. workdayIn): задача,
// отложенная в пятницу «до завтра», возвращается в понедельник.
function workday(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(workdayIn(new Date(y, m - 1, d), n));
}

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

// «ср 21.10» — день недели рядом с числом: откладывают «до четверга», а
// не «до 22-го», и без дня недели число приходится пересчитывать в уме.
export function snoozeDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

// Варианты — днями, которые называют вслух: «завтра», «в понедельник»,
// «через неделю», «через две». День — тот, когда задача вернётся и бот
// напомнит.
//
// «К сроку» (20.10.2026, доработка по просьбе «улучши механизм отложенных
// задач»): самый частый смысл «отложить» — «не мозоль глаза, пока не
// подойдёт срок». Без этого варианта день срока приходилось подбирать из
// трёх чужих, и задача возвращалась то раньше, то уже просроченной.
export function snoozeChoices(today: string, deadline?: string): { value: string; label: string }[] {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const toMonday = ((8 - weekday) % 7) || 7;
  const options = [
    { value: workday(today, 1), label: "Завтра" },
    { value: addDays(today, toMonday), label: "В понедельник" },
    { value: workday(today, 7), label: "Через неделю" },
    { value: workday(today, 14), label: "Через две недели" },
  ];
  // К сроку — только если он впереди и не совпадает с «завтра»: вернуть
  // задачу в день, который уже наступил, значит не отложить её вовсе.
  if (deadline && deadline > workday(today, 1)) options.push({ value: deadline, label: "К сроку" });
  // С пятницы по воскресенье «завтра» и «в понедельник» — один день; срок
  // может совпасть с любым из вариантов — тогда остаётся первый.
  return options
    .filter((o, i) => options.findIndex((x) => x.value === o.value) === i)
    .sort((a, b) => a.value.localeCompare(b.value))
    .map((o) => ({ value: o.value, label: `${o.label}, ${snoozeDay(o.value)}` }));
}

// Отложить ПОЗЖЕ срока — значит увидеть задачу уже просроченной. Это не
// запрет (бывает, что срок поедет и так), но сказать об этом надо до
// выбора, а не в день возвращения.
export function snoozePastDeadline(choice: string, deadline?: string): boolean {
  return !!choice && !!deadline && choice > deadline;
}
