// Срок на кубике — словами, а не числом.
//
// «до 19.10.2026» отвечало на «какого числа», но не на тот вопрос, ради
// которого на срок смотрят: сколько осталось. Кирилл 13.10.2026: «дедлайн
// тоже более выразителен должен быть». Поэтому день недели и месяц —
// словом, остаток — числом, а тон пилюли говорит о срочности раньше, чем
// её прочитали.
//
// Считается по календарным дням местного времени: «завтра» — это завтра,
// даже если завтра суббота (рабочие дни считает «скоро», см. isDueSoon).

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export type DueTone = "late" | "today" | "soon" | "normal";

export type DueInfo = { text: string; tone: DueTone; title: string };

function parse(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function dueInfo(deadline: string, opts: { today: string; soon?: boolean }): DueInfo | null {
  const due = parse(deadline);
  const now = parse(opts.today);
  if (!due || !now) return null;
  const days = daysBetween(now, due);
  const sameYear = due.getFullYear() === now.getFullYear();
  const day = `${due.getDate()} ${MONTHS[due.getMonth()]}${sameYear ? "" : " " + due.getFullYear()}`;
  const full = `Срок: ${String(due.getDate()).padStart(2, "0")}.${String(due.getMonth() + 1).padStart(2, "0")}.${due.getFullYear()}`;
  if (days < 0) return { text: `Просрочено ${-days} дн.`, tone: "late", title: `${full} — просрочено на ${-days} дн.` };
  if (days === 0) return { text: "Сегодня", tone: "today", title: `${full} — сегодня` };
  if (days === 1) return { text: "Завтра", tone: opts.soon === false ? "normal" : "soon", title: `${full} — завтра` };
  // Остаток числом — только пока он помещается в голову: «через 40 дн.»
  // читают как дату, и тогда дата полезнее.
  const tail = days <= 14 ? ` · ${days} дн.` : "";
  return { text: `До ${day}${tail}`, tone: opts.soon ? "soon" : "normal", title: `${full} — осталось ${days} дн.` };
}
