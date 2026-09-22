// Pure idea-list ordering, ported from legacy-tracker.js's renderIdeas():
// hides done ideas unless showDone is set, newest-first, with done ideas
// (when shown) sorted after active ones — and, among those, most recently
// ticked off first, so the one just closed is the first you can un-tick.
import type { Idea } from "@/types/tracker";

export function sortIdeasForList(ideas: Idea[], showDone: boolean): Idea[] {
  const visible = ideas.filter((i) => showDone || !i.done);
  return visible
    .slice()
    .reverse()
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      // Помеченные «важно» — наверх, внутри группы по-прежнему свежие
      // первыми. При сорока мыслях флаг перестаёт работать как пометка:
      // он виден, только если строку и так нашли глазами, а искать её
      // приходится среди тех, что записаны позже и важными не помечены.
      if (!a.done) {
        if (!!a.important !== !!b.important) return a.important ? -1 : 1;
        return 0; // остальные активные держат порядок «новые сверху»
      }
      // Done ideas without a doneAt (ticked off before that column existed)
      // fall back to the reversed creation order rather than jumping ahead.
      const ad = a.doneAt || "";
      const bd = b.doneAt || "";
      if (ad === bd) return 0;
      return ad > bd ? -1 : 1;
    });
}

// Вычеркнутые мысли для окна «Вычеркнутые мысли» — самыми свежими вверх.
//
// Окно показывало их в том порядке, в каком они лежат в массиве, то есть
// по времени СОЗДАНИЯ: наверху мысль, записанная в августе и вычеркнутая
// вчера, внизу закрытая минуту назад. Смотрят этот список ровно затем,
// чтобы вернуть только что вычеркнутое, — как столбец «Завершённые» у
// доски и «Прошедшие встречи» у панели встреч, где порядок закрытия уже
// стоит первым. Правило одно на все три списка, и живёт оно здесь, а не в
// разметке окна: сортировка вычеркнутых уже описана выше, и второй её
// копии рядом быть не должно.
export function doneIdeasNewestFirst(ideas: Idea[]): Idea[] {
  return sortIdeasForList(ideas, true).filter((i) => i.done);
}
