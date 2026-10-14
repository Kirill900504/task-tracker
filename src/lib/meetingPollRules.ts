import { fmtDate } from "@/lib/taskDisplay";

// Опрос времени встречи — чистая часть правила (миграция 0062): её зовут и
// окно встречи в браузере, и сервер (lib/meetingPoll). Отдельным файлом,
// потому что серверный модуль тянет рассылку, и импорт его в окно утащил
// бы её в браузер (то же решение, что meetingRepeatLabels).

export type SlotOption = { date: string; time: string };

export function slotLabel(o: SlotOption): string {
  return fmtDate(o.date) + (o.time ? ", " + o.time : "");
}

// Порядок вариантов по убыванию голосов, при равенстве — раньше лучше.
// Чистая функция: её проверяют тесты без базы.
export function rankSlots(options: SlotOption[], votes: number[][]): number[] {
  const count = options.map((_, i) => votes.filter((v) => v.includes(i)).length);
  return options
    .map((_, i) => i)
    .sort((a, b) => count[b] - count[a] || (options[a].date + options[a].time).localeCompare(options[b].date + options[b].time));
}

export function cleanSlots(value: unknown, max: number): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < max))].sort((a, b) => a - b);
}

export function isPoll(m: { status?: string | null; slot_options?: unknown; slotOptions?: unknown }): boolean {
  const opts = (m.slot_options ?? m.slotOptions) as unknown[] | undefined;
  return m.status === "proposed" && Array.isArray(opts) && opts.length >= 2;
}
