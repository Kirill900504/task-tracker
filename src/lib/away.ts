// Отсутствия (миграция 0047): почему на строке человека и почему без даты
// начала — написано там.

export type AwayKind = "vacation" | "sick" | "trip" | "other";

export const AWAY_KINDS: { value: AwayKind; label: string }[] = [
  { value: "vacation", label: "Отпуск" },
  { value: "sick", label: "Больничный" },
  { value: "trip", label: "Командировка" },
  { value: "other", label: "Другое" },
];

const PHRASE: Record<AwayKind, string> = {
  vacation: "в отпуске",
  sick: "на больничном",
  trip: "в командировке",
  other: "отсутствует",
};

// Нет ли человека в этот день. Дата возвращения — последний день
// отсутствия: «нет до 15.10» значит, что 15-го его ещё нет.
export function isAwayOn(awayUntil: string | null | undefined, date: string): boolean {
  return !!awayUntil && !!date && date <= awayUntil;
}

function ddmm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
}

// «в отпуске до 15.10» — то, что стоит рядом с именем.
export function awayPhrase(kind: string | null | undefined, until: string): string {
  return `${PHRASE[(kind as AwayKind) || "other"] || PHRASE.other} до ${ddmm(until)}`;
}

// Короткая пометка на кнопке человека: на четырнадцати кнопках подряд
// целая фраза не помещается.
export function awayMark(until: string): string {
  return `нет до ${ddmm(until)}`;
}

// Варианты срока: отмечают, уходя, и считать дни в календаре в этот
// момент некогда. Дата — последний день отсутствия.
export function awayUntilChoices(today: string): { value: string; label: string }[] {
  const add = (n: number) => {
    const [y, m, d] = today.split("-").map(Number);
    const at = new Date(Date.UTC(y, m - 1, d + n));
    return at.toISOString().slice(0, 10);
  };
  return [
    { value: add(0), label: "Только сегодня" },
    { value: add(1), label: "До завтра" },
    { value: add(6), label: "Неделю" },
    { value: add(13), label: "Две недели" },
  ];
}

// «15.10» или «15.10.2026» → ISO. Год по умолчанию — ближайший впереди:
// в декабре «10.01» — это январь следующего года.
export function parseAwayDate(text: string, today: string): string | null {
  const m = /^\s*(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\s*$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : Number(today.slice(0, 4));
  const iso = (y: number) => `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  if (!m[3] && iso(year) < today) year += 1;
  return iso(year);
}
