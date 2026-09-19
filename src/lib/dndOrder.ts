// Куда встанет то, что несут.
//
// Один и тот же порядок нужен дважды и обязан совпадать: сначала на экране,
// пока карточка едет и соседи расступаются, потом в базе, когда её
// отпустили. Раньше это считалось в двух местах по-разному — предпросмотр
// рисовался полоской «сюда», а вставка искалась заново по координатам
// курсора, — и совпадало оно только потому, что за ним следили.

// Вставить перед указанным соседом (или в конец, если соседа нет). Нужно
// при переезде в ДРУГОЙ список, где у переносимого элемента прежнего места
// не было.
//
// «Перед самим собой» означает «оставить как есть»: иначе карточка,
// отпущенная над собственным силуэтом, молча уезжала бы в конец списка.
export function insertBefore(ids: string[], moved: string, beforeId: string | null): string[] {
  if (beforeId === moved) return ids.includes(moved) ? ids : [...ids, moved];
  const rest = ids.filter((id) => id !== moved);
  const at = beforeId ? rest.indexOf(beforeId) : -1;
  rest.splice(at === -1 ? rest.length : at, 0, moved);
  return rest;
}

// Переставить ВНУТРИ списка — туда, где сейчас сосед, над которым курсор.
//
// Это не то же самое, что «вставить перед ним», и разница видна глазом:
// когда карточку тянут ВНИЗ, она должна встать на место соседа, то есть
// после него, а вставка «перед» оставляла бы её на позицию выше, чем
// человек целился. Ровно так работает перетаскивание в любом списке, и
// ровно этого от него ждут.
export function moveWithin(ids: string[], moved: string, overId: string | null): string[] {
  const from = ids.indexOf(moved);
  if (from === -1 || !overId || overId === moved) return ids;
  const to = ids.indexOf(overId);
  if (to === -1) return ids;

  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => b[i] === id);
}
