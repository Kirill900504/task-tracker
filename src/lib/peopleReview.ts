import type { SupabaseClient } from "@supabase/supabase-js";
import { isSelfAssignee } from "@/lib/trackerRows";
import { overdueOn } from "@/lib/taskLogic";

// Понедельничная цифра человеку о его СОБСТВЕННОЙ неделе (composeMyWeek).
//
// Раньше отсюда же собиралась сводка владельцу «по людям» — кто молчит,
// кто просрочил, «стоит спросить лично». Она удалена 29.10.2026: концепция
// трекера с 20.10.2026 — равноправие и конфиденциальность, и сводка о
// людях, которую получает один человек, — это и неравенство, и утечка.
// Не возвращайте её ни в каком виде, даже «только числами».
//
// Всё здесь считается кодом, а не моделью: человек, которому сказали
// «просрочено четыре», должен иметь возможность открыть список и увидеть
// ровно четыре.
//
// Участие всех исполнителей пространства читается одним запросом: крон
// считает цифры каждому сразу, а получает каждый только свою строку.
export async function buildParticipation(admin: SupabaseClient, userId: string): Promise<ParticipationRow[]> {
  const { data: rows } = await admin
    .from("task_participants")
    .select("created_at, accepted_at, done_at, declined_at, assignees(name), tasks(deadline, status, deleted_at, recur)")
    .eq("user_id", userId)
    .eq("role", "executor");

  type Raw = {
    created_at: string;
    accepted_at: string | null;
    done_at: string | null;
    declined_at: string | null;
    assignees: { name: string } | { name: string }[] | null;
    tasks: { deadline: string | null; status: string | null; deleted_at: string | null; recur: string | null } | null;
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
    // Строку владельца «(я)» крон всё равно пропускает при рассылке (чат у
    // неё пустой), поэтому и считать её незачем.
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
        recur: r.tasks!.recur || "none",
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
  // Повтор — ради правила просрочки доски (taskLogic.overdueOn).
  recur?: string;
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
      overdue: openRows.filter((r) => overdueOn(r, today)).length,
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

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function hoursWord(h: number): string {
  const rounded = Math.round(h);
  if (rounded < 1) return "меньше часа";
  if (rounded < 24) return `${rounded} ч`;
  return `${Math.round(h / 24)} дн`;
}

// Человеку про него самого (G4 в docs/multiuser.md).
//
// Решение записано там одной фразой: «цифра о себе меняет поведение дешевле
// любого разговора». Из неё следует и всё остальное здесь.
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
