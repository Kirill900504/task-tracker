// Russian plural agreement: 1 задача, 2 задачи, 5 задач. Needed wherever a
// count goes straight into a sentence the user reads ("Всего в работе 3
// задач" is the kind of thing that makes generated text feel machine-made).
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function tasksWord(n: number): string {
  return plural(n, "задача", "задачи", "задач");
}
