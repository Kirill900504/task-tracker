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

// Варианты — днями, которые называют вслух: «завтра», «в понедельник»,
// «через неделю». День — тот, когда задача вернётся и бот напомнит.
export function snoozeChoices(today: string): { value: string; label: string }[] {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const toMonday = ((8 - weekday) % 7) || 7;
  const fmt = (iso: string) => iso.slice(8, 10) + "." + iso.slice(5, 7);
  const options = [
    { value: workday(today, 1), label: "Завтра" },
    { value: addDays(today, toMonday), label: `В понедельник, ${fmt(addDays(today, toMonday))}` },
    { value: workday(today, 7), label: `Через неделю, ${fmt(workday(today, 7))}` },
  ];
  // С пятницы по воскресенье «завтра» и «в понедельник» — один день.
  return options.filter((o, i) => options.findIndex((x) => x.value === o.value) === i);
}
