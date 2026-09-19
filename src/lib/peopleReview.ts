import type { SupabaseClient } from "@supabase/supabase-js";
import { isSelfAssignee } from "@/lib/trackerRows";

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

// Данные для обеих сводок собираются один раз и одним запросом — не ради
// экономии, а ради того же самого: владелец и руководитель должны видеть
// цифры, посчитанные из одних и тех же строк в одну и ту же секунду.
export async function buildParticipation(admin: SupabaseClient, userId: string): Promise<ParticipationRow[]> {
  const { data: rows } = await admin
    .from("task_participants")
    .select("created_at, accepted_at, done_at, declined_at, assignees(name), tasks(deadline, status, deleted_at)")
    .eq("user_id", userId)
    .eq("role", "executor");

  type Raw = {
    created_at: string;
    accepted_at: string | null;
    done_at: string | null;
    declined_at: string | null;
    assignees: { name: string } | { name: string }[] | null;
    tasks: { deadline: string | null; status: string | null; deleted_at: string | null } | null;
  };

  const { data: members } = await admin
    .from("workspace_members")
    .select("assignee_id, direction, assignees(name)")
    .eq("owner_id", userId);
  const directionOf = new Map<string, string>();
  for (const m of ((members || []) as { direction: string; assignees: { name: string } | { name: string }[] | null }[])) {
    const n = Array.isArray(m.assignees) ? m.assignees[0]?.name : m.assignees?.name;
    if (n) directionOf.set(n, m.direction || "");
  }

  return ((rows || []) as unknown as Raw[])
    .filter((r) => r.tasks && !r.tasks.deleted_at)
    .map((r) => {
      const name = (Array.isArray(r.assignees) ? r.assignees[0]?.name : r.assignees?.name) || "";
      return { name, row: r };
    })
    // Себя в сводке по людям быть не должно. «Кирилл (я): не ответил на 4»
    // — это не дисциплина, это его собственный список дел, и строка «стоит
    // спросить лично: Кирилл (я)» предлагает поговорить с самим собой.
    // Та же ошибка уже находилась в блоке молчания (silence.ts) — и найдена
    // обе раза одинаково: предпросмотром на настоящих данных.
    .filter(({ name }) => name && !isSelfAssignee(name))
    .map(({ name, row: r }) => {
      return {
        name,
        direction: directionOf.get(name) || "",
        createdAt: r.created_at,
        acceptedAt: r.accepted_at,
        doneAt: r.done_at,
        declinedAt: r.declined_at,
        deadline: r.tasks!.deadline || "",
        status: r.tasks!.status || "in_progress",
      };
    });
}

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
  // Среднее время ОТ «принял» ДО «сделал». Вторая половина того же
  // вопроса: первая цифра говорит, сколько человек думает, прежде чем
  // взяться, вторая — сколько делает. Вместе они отвечают на «где затык»
  // точнее, чем количество просроченных: две просрочки у того, кто берётся
  // мгновенно и делает три недели, и у того, кто неделю не открывает
  // задачу, — это разные разговоры.
  avgWorkHours: number | null;
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

    // Считается только по тем, кто СНАЧАЛА принял, а потом отчитался.
    // Отчёт без «принял» — это работа, о начале которой мы ничего не знаем,
    // и приписывать ей нулевое время значило бы хвалить за молчание.
    const workHours = list
      .filter((r) => r.acceptedAt && r.doneAt)
      .map((r) => hoursBetween(r.acceptedAt!, r.doneAt!))
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
      avgWorkHours: workHours.length ? workHours.reduce((a, b) => a + b, 0) / workHours.length : null,
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
    if (s.avgWorkHours !== null) bits.push(`делает за ${hoursWord(s.avgWorkHours)}`);
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

// То же самое, но человеку про него самого (G4 в docs/multiuser.md).
//
// Решение записано там одной фразой: «цифра о себе меняет поведение дешевле
// любого разговора». Из неё следует и всё остальное здесь.
//
// Считается ровно той же функцией, что и сводка владельца, — не похожей, а
// той же. Показывать человеку одно, а начальнику про него другое было бы
// началом недоверия, и первый же разговор, где цифры не сошлись, стоил бы
// дороже всей затеи.
//
// Тон — не обвинение. Это отчёт о себе, а не выговор: сначала сделанное,
// потом висящее, и только потом то, о чём стоит помнить. И прямо сказано,
// что молчание видно постановщику: человек имеет право знать, как это
// выглядит с той стороны, — иначе цифра превращается в донос за спиной.
export function composeMyWeek(s: PersonStats): string {
  if (!s.open && !s.doneThisWeek && !s.declined) return "";

  const lines = ["📈 Ваша неделя", ""];
  const bits: string[] = [];
  if (s.doneThisWeek) bits.push(`закрыто ${s.doneThisWeek}`);
  if (s.open) bits.push(`в работе ${s.open}`);
  if (s.overdue) bits.push(`просрочено ${s.overdue}`);
  if (s.declined) bits.push(`отказались от ${s.declined}`);
  lines.push(bits.join(", "));

  const marks: string[] = [];
  if (s.onTimeShare !== null) marks.push(`В срок: ${Math.round(s.onTimeShare * 100)}%`);
  if (s.avgAcceptHours !== null) marks.push(`Отвечаете в среднем за ${hoursWord(s.avgAcceptHours)}`);
  if (s.avgWorkHours !== null) marks.push(`Делаете в среднем за ${hoursWord(s.avgWorkHours)}`);
  if (marks.length) lines.push("", marks.join(". ") + ".");

  if (s.silent) {
    lines.push(
      "",
      `Ещё не ответили: ${s.silent} — это видно и тому, кто поручил. ` +
        "Одно нажатие «Принял» или «Не могу» снимает вопрос.",
    );
  }
  return lines.join("\n");
}
