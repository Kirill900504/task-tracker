import type { Idea } from "@/types/tracker";

// Разбор мыслей раз в неделю.
//
// 07.10.2026: из 67 мыслей открыты 32 — больше, чем задач, — то есть ящик,
// который только наполняется. Кирилл согласился на еженедельный разбор с
// одной оговоркой: «давай попробуем, только без вычёркивания». Поэтому у
// разбираемой мысли три исхода — в задачу, во встречу или «оставить», — а
// «вычеркнуть» в нём нет: вычеркнуть можно и сейчас, галочкой у мысли.
//
// Разбор — строка в панели мыслей с пятницы по воскресенье, а не сообщение
// бота: «не засорять эфир» он сказал в том же ответе про сводки.
// «Оставить» и «потом» помнятся до конца недели в браузере человека — это
// его удобство, а не данные трекера, и на следующей неделе мысль снова
// попадёт в разбор, если так и не сдвинулась.

export const STALE_DAYS = 7;
export const REVIEW_WEEKDAYS = [5, 6, 0]; // пятница, суббота, воскресенье

// createdAt у мысли — строка для показа «дд.мм.гггг чч:мм» (см. trackerRows).
export function ideaCreated(createdAt: string): Date | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(createdAt || "");
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0));
}

export function isReviewDay(now: Date): boolean {
  return REVIEW_WEEKDAYS.includes(now.getDay());
}

// Неделя, к которой относится разбор: дата её понедельника. Ключ памяти
// «оставить / не сейчас» — чтобы в следующую пятницу всё началось заново.
export function reviewWeek(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Что ждёт разбора: свои живые мысли старше недели, кроме оставленных на
// этой неделе. Старые — первыми: они дольше всего ждут решения.
export function ideasToReview(ideas: Idea[], now: Date, kept: Set<string>, isOwn: (idea: Idea) => boolean): Idea[] {
  const edge = now.getTime() - STALE_DAYS * 864e5;
  return ideas
    .filter((idea) => !idea.done && isOwn(idea) && !kept.has(idea.id))
    .map((idea) => ({ idea, at: ideaCreated(idea.createdAt) }))
    .filter((x) => x.at && x.at.getTime() <= edge)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime())
    .map((x) => x.idea);
}
