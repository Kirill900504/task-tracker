import type { Task } from "@/types/tracker";
import type { MyRole } from "@/lib/myRole";
import { isMine } from "@/lib/ownership";

// Фильтры доски «Я поручил · Мне · Помогаю» — кнопки, а не переключатель.
//
// Слова Кирилла 14.10.2026: «кнопки должны нажиматься и отжиматься обратно
// по принципу фильтров… в кнопку „Помогаю“ должны попадать все задачи, где
// человек является соисполнителем и наблюдателем… возможность нажимать по
// 2 или даже все три кнопки: если я хочу видеть только поставленные мной и
// мне задачи, я просто зажимаю „Я поручил“ и „Мне“». До этого был выбор
// одного из трёх («Все / Мне / Я поручил»), и «поручил + мне без чужих
// наблюдений» собрать было нельзя вовсе.
//
// Отсюда правило: ни одна не нажата — вся доска; нажатые складываются
// (задача видна, если подходит хотя бы под одну). Задача самому себе
// попадает и в «Я поручил», и в «Мне» — она и то и другое.
export type BoardFilterKey = "assigned" | "mine" | "helping";

export const BOARD_FILTERS: { key: BoardFilterKey; label: string; title: string }[] = [
  { key: "assigned", label: "Я поручил", title: "Задачи, которые поставили вы" },
  { key: "mine", label: "Мне", title: "Задачи, где вы исполнитель" },
  { key: "helping", label: "Помогаю", title: "Задачи, где вы соисполнитель или наблюдатель" },
];

export function matchesBoardFilter(keys: BoardFilterKey[], task: Task, role: MyRole, myUserId: string): boolean {
  if (!keys.length) return true;
  return keys.some((key) => {
    if (key === "assigned") return isMine(task, myUserId);
    if (key === "mine") return role === "executor";
    return role === "coexecutor" || role === "watcher";
  });
}

// Нажатие: включить, если выключена, и выключить, если включена. Порядок в
// списке — порядок кнопок, чтобы сохранённое значение не зависело от того,
// в какой последовательности их нажимали.
export function toggleBoardFilter(keys: BoardFilterKey[], key: BoardFilterKey): BoardFilterKey[] {
  const next = keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
  return BOARD_FILTERS.map((f) => f.key).filter((k) => next.includes(k));
}

// Сохранённое значение читается из браузера и может оказаться чем угодно
// (старая версия, ручная правка) — в фильтр пускаются только известные ключи.
export function cleanBoardFilter(value: unknown): BoardFilterKey[] {
  const known = new Set(BOARD_FILTERS.map((f) => f.key));
  return Array.isArray(value) ? BOARD_FILTERS.map((f) => f.key).filter((k) => known.has(k) && value.includes(k)) : [];
}
