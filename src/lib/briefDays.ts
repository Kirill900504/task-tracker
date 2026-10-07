// По каким дням выходит утренняя сводка — и до какого дня она смотрит вперёд.
//
// 07.10.2026, его словами: «утреннюю сводку давай сделаем пока только по
// понедельникам и средам (чтобы не засорял эфир и не бесил каждый день)».
// Каждый день сводка приходила и владельцу, и каждому подключённому — то
// есть пятью сообщениями в неделю учила их не читать её вовсе.
//
// Раз сводка реже, она обязана смотреть дальше «сегодня»: срок во вторник
// или в пятницу иначе не попал бы ни в одну. Поэтому вместе с днём выхода
// здесь же — до какого дня она предупреждает о сроках: в понедельник — до
// среды включительно, в среду — до следующего понедельника.
//
// День берётся из `now`, уже сдвинутого в московское время (moscowNow в
// кроне), — поэтому getUTCDay, а не getDay.

export const BRIEF_WEEKDAYS = [1, 3]; // понедельник, среда

export function isBriefDay(moscowNow: Date): boolean {
  return BRIEF_WEEKDAYS.includes(moscowNow.getUTCDay());
}

// Последний день, о сроках которого говорит сегодняшняя сводка: день
// СЛЕДУЮЩЕЙ сводки включительно. Не день выхода — пустая строка.
export function briefLooksUntil(moscowNow: Date): string {
  const day = moscowNow.getUTCDay();
  if (!BRIEF_WEEKDAYS.includes(day)) return "";
  const next = BRIEF_WEEKDAYS.map((d) => ((d - day + 7) % 7) || 7).sort((a, b) => a - b)[0];
  const until = new Date(moscowNow);
  until.setUTCDate(until.getUTCDate() + next);
  return until.toISOString().slice(0, 10);
}
