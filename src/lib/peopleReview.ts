// Понедельничная сводка по людям, а не по задачам.
//
// Владельцу уже приходит утренняя сводка и недельный обзор — оба про
// задачи: что просрочено, что горит, что закрыто. Ни один из них не
// отвечает на вопрос, ради которого всё это затевалось: кто из
// руководителей держит слово, а кто тихо не отвечает. Разговор о мотивации
// без этой цифры превращается в обмен впечатлениями, а с ней — в разговор.
//
// Всё здесь считается кодом. Модель может это потом переписать словами
// (как в dailyBrief), но ни одна цифра не приходит от неё: человек, о
// котором сказали «просрочил четыре», должен иметь возможность открыть
// список и увидеть ровно четыре.

export type ParticipationRow = {
  name: string;
  direction: string;
  // Когда человека назначили — точка отсчёта для «сколько думал».
  createdAt: string;
  acceptedAt: string | null;
  doneAt: string | null;
  declinedAt: string | null;
  // Срок самой задачи и её состояние.
  deadline: string;
  status: string;
};

export type PersonStats = {
  name: string;
  direction: string;
  open: number;
  overdue: number;
  // Назначено больше суток назад и до сих пор ни принято, ни отклонено.
  silent: number;
  declined: number;
  doneThisWeek: number;
  // Среднее время до «принял», в часах. null — принимать было нечего.
  avgAcceptHours: number | null;
  // Доля закрытого в срок, 0..1. null — закрывать было нечего.
  onTimeShare: number | null;
};

const DAY = 24 * 60 * 60 * 1000;

function hoursBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return (b - a) / (60 * 60 * 1000);
}

export function personStats(rows: ParticipationRow[], now: Date): PersonStats[] {
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();

  const byName = new Map<string, ParticipationRow[]>();
  for (const r of rows) {
    if (!r.name) continue;
    const list = byName.get(r.name);
    if (list) list.push(r);
    else byName.set(r.name, [r]);
  }

  const out: PersonStats[] = [];
  for (const [name, list] of byName) {
    const openRows = list.filter((r) => !r.doneAt && r.status !== "done");
    const accepted = list.filter((r) => r.acceptedAt);
    const acceptHours = accepted
      .map((r) => hoursBetween(r.createdAt, r.acceptedAt!))
      .filter((h): h is number => h !== null);

    // «В срок» считается только по тем, у кого срок вообще был: закрыть
    // бессрочную задачу «вовремя» нельзя ни при каком старании.
    const closedWithDeadline = list.filter((r) => r.doneAt && r.deadline);
    const onTime = closedWithDeadline.filter((r) => r.doneAt!.slice(0, 10) <= r.deadline);

    out.push({
      name,
      direction: list.find((r) => r.direction)?.direction || "",
      open: openRows.length,
      overdue: openRows.filter((r) => r.deadline && r.deadline < today).length,
      silent: openRows.filter(
        (r) => !r.acceptedAt && !r.declinedAt && Date.parse(r.createdAt) < now.getTime() - DAY,
      ).length,
      declined: openRows.filter((r) => r.declinedAt).length,
      doneThisWeek: list.filter((r) => r.doneAt && r.doneAt >= weekAgo).length,
      avgAcceptHours: acceptHours.length ? acceptHours.reduce((a, b) => a + b, 0) / acceptHours.length : null,
      onTimeShare: closedWithDeadline.length ? onTime.length / closedWithDeadline.length : null,
    });
  }

  // Сначала те, к кому есть вопросы: молчащие, потом просрочившие.
  out.sort((a, b) => b.silent - a.silent || b.overdue - a.overdue || a.name.localeCompare(b.name));
  return out;
}

function hoursWord(h: number): string {
  const rounded = Math.round(h);
  if (rounded < 1) return "меньше часа";
  if (rounded < 24) return `${rounded} ч`;
  return `${Math.round(h / 24)} дн`;
}

export function reviewIsEmpty(stats: PersonStats[]): boolean {
  return !stats.some((s) => s.open || s.doneThisWeek || s.declined);
}

export function composePeopleReview(stats: PersonStats[]): string {
  if (reviewIsEmpty(stats)) return "";
  const lines = ["📊 Неделя по людям", ""];

  for (const s of stats) {
    if (!s.open && !s.doneThisWeek && !s.declined) continue;
    const bits: string[] = [];
    if (s.open) bits.push(`в работе ${s.open}`);
    if (s.overdue) bits.push(`просрочено ${s.overdue}`);
    if (s.silent) bits.push(`не ответил на ${s.silent}`);
    if (s.declined) bits.push(`отказался от ${s.declined}`);
    if (s.doneThisWeek) bits.push(`закрыл ${s.doneThisWeek}`);
    if (s.avgAcceptHours !== null) bits.push(`принимает за ${hoursWord(s.avgAcceptHours)}`);
    if (s.onTimeShare !== null) bits.push(`в срок ${Math.round(s.onTimeShare * 100)}%`);
    const where = s.direction ? ` (${s.direction})` : "";
    lines.push(`• ${s.name}${where}: ${bits.join(", ")}`);
  }

  // Одна строка вывода вместо тринадцати строк, которые надо сравнивать
  // глазами: кому написать сегодня.
  const worry = stats.filter((s) => s.silent || s.overdue >= 3);
  if (worry.length) {
    lines.push("", "Стоит спросить лично: " + worry.map((s) => s.name).join(", "));
  }
  return lines.join("\n");
}
