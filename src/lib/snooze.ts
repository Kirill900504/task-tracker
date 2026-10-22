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

// Готовых вариантов два — «Завтра» и «Через неделю», а любой другой день
// выбирают в календаре рядом с ними. Слова Кирилла 22.10.2026: «сделать
// стандартное окно календаря и варианты выбора число, завтра, через
// неделю» — так же, как срок задачи и дата встречи. Прежние четыре-пять
// кнопок («в понедельник», «через две недели», «к сроку») были попыткой
// угадать день без календаря; с календарём угадывать незачем.
export function snoozeChoices(today: string): { value: string; label: string }[] {
  return [
    { value: workday(today, 1), label: "Завтра" },
    { value: workday(today, 7), label: "Через неделю" },
  ].map((o) => ({ value: o.value, label: `${o.label}, ${snoozeDay(o.value)}` }));
}

// Раньше завтрашнего дня в календаре не выбрать: «до сегодня» — это не
// отложить вовсе.
export function snoozeMinDate(today: string): string {
  return addDays(today, 1);
}

// Отложить ПОЗЖЕ срока — значит увидеть задачу уже просроченной. Это не
// запрет (бывает, что срок поедет и так), но сказать об этом надо до
// выбора, а не в день возвращения.
export function snoozePastDeadline(choice: string, deadline?: string): boolean {
  return !!choice && !!deadline && choice > deadline;
}
