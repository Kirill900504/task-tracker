// Куда встанет то, что несут.
//
// Один и тот же порядок нужен дважды и обязан совпадать: сначала на экране,
// пока карточка едет и соседи расступаются, потом в базе, когда её
// отпустили. Раньше это считалось в двух местах по-разному — предпросмотр
// рисовался полоской «сюда», а вставка искалась заново по координатам
// курсора, — и совпадало оно только потому, что за ним следили.

export function insertBefore(ids: string[], moved: string, beforeId: string | null): string[] {
  const rest = ids.filter((id) => id !== moved);
  const at = beforeId && beforeId !== moved ? rest.indexOf(beforeId) : -1;
  rest.splice(at === -1 ? rest.length : at, 0, moved);
  return rest;
}

export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => b[i] === id);
}
