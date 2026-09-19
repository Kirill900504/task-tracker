import type { SupabaseClient } from "@supabase/supabase-js";

// Просроченное должно подавать голос.
//
// Просрочка была видна в двух местах: цветом в трекере и строкой в утренней
// сводке. Больше не происходило ничего — задача могла висеть неделями, и
// единственный, кто об этом узнавал, был тот, кто откроет трекер. То есть
// ровно то, ради чего трекер и затевался («дал поручение — забыл
// проверить»), продолжало случаться, только медленнее.
//
// Три ступени, и они не про наказание, а про то, что на разных сроках
// разумно разное:
//
//   * ТРИ дня — человеку. Скорее всего он просто забыл, и вопрос с
//     кнопками («делаю» / «не могу» / «прошу перенос») закрывает это
//     быстрее любого разговора;
//   * СЕМЬ — постановщику. Если за неделю после напоминания не изменилось
//     ничего, дело уже не в забывчивости, и решать это человеку, а не
//     трекеру;
//   * ЧЕТЫРНАДЦАТЬ — обоим, и последний раз. Дальше трекер замолкает: он
//     сказал всё, что мог, и превращаться в будильник, который никто не
//     выключает, ему незачем.
//
// Каждая ступень срабатывает ОДИН раз за всю жизнь задачи (см. onceOnly с
// ключом из задачи и ступени), а не каждый день после неё: напоминание,
// приходящее ежедневно, перестаёт быть напоминанием за три дня.

export const STEPS = [3, 7, 14] as const;
export type Step = (typeof STEPS)[number];

export type StuckTask = {
  taskId: string;
  title: string;
  deadline: string;
  // Кому поручено — те, кто ещё не ответил и не отчитался.
  waiting: { assigneeId: string; name: string }[];
  createdBy: string | null;
};

// На какую ступень вышла задача СЕГОДНЯ. Ровно на ступень, а не «больше
// либо равно»: иначе задача, просроченная на месяц, каждый день сообщала бы
// о том, что перешагнула тройку.
export function stepFor(deadline: string, today: string): Step | null {
  const days = daysBetween(deadline, today);
  return (STEPS as readonly number[]).includes(days) ? (days as Step) : null;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export function nudgeText(task: { title: string; deadline: string }, days: number): string {
  return (
    `⏰ Задача «${task.title}» просрочена на ${days} ${plural(days)}.\n\n` +
    "Что с ней? Ответьте кнопкой — этого достаточно."
  );
}

export function alarmText(task: { title: string; deadline: string }, days: number, names: string[]): string {
  const who = names.length ? names.join(", ") : "исполнитель";
  return `⏰ «${task.title}» просрочена на ${days} ${plural(days)}, и ответа нет. Ждём: ${who}.`;
}

function plural(n: number): string {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  if (!teen && last === 1) return "день";
  if (!teen && last >= 2 && last <= 4) return "дня";
  return "дней";
}

// Задачи, у которых сегодня годовщина просрочки — три дня, неделя или две.
//
// Повторяющиеся не берутся: у них срок не дата, а правило, и «просрочена на
// три дня» про них ничего не значит. Закрытые и те, где исполнитель уже
// отчитался, тоже: ждать там нечего.
export async function findStuck(admin: SupabaseClient, userId: string, today: string): Promise<{ task: StuckTask; step: Step }[]> {
  const { data } = await admin
    .from("tasks")
    .select("id, title, deadline, created_by, status, recur, approval_state")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .eq("recur", "none")
    .not("deadline", "is", null)
    .is("deleted_at", null);

  type Row = { id: string; title: string; deadline: string; created_by: string | null; approval_state: string | null };
  const rows = ((data || []) as Row[]).filter((t) => t.deadline < today && t.approval_state !== "awaiting_review");
  if (!rows.length) return [];

  const withStep = rows
    .map((t) => ({ row: t, step: stepFor(t.deadline, today) }))
    .filter((x): x is { row: Row; step: Step } => x.step !== null);
  if (!withStep.length) return [];

  const { data: parts } = await admin
    .from("task_participants")
    .select("task_id, assignee_id, role, done_at, declined_at, assignees(name)")
    .in("task_id", withStep.map((x) => x.row.id));

  type PRow = {
    task_id: string;
    assignee_id: string;
    role: string;
    done_at: string | null;
    declined_at: string | null;
    assignees: { name: string } | { name: string }[] | null;
  };

  const waitingBy = new Map<string, { assigneeId: string; name: string }[]>();
  for (const p of ((parts as unknown as PRow[]) || [])) {
    // Отказ — это ответ. С человеком, сказавшим «не могу», разговор другой,
    // и напоминать ему о сроке значит не услышать то, что он уже сказал.
    if (p.role !== "executor" || p.done_at || p.declined_at) continue;
    const a = p.assignees;
    const name = (Array.isArray(a) ? a[0]?.name : a?.name) || "";
    const list = waitingBy.get(p.task_id) || [];
    list.push({ assigneeId: p.assignee_id, name });
    waitingBy.set(p.task_id, list);
  }

  return withStep
    .map(({ row, step }) => ({
      task: {
        taskId: row.id,
        title: row.title,
        deadline: row.deadline,
        waiting: waitingBy.get(row.id) || [],
        createdBy: row.created_by,
      },
      step,
    }))
    .filter((x) => x.task.waiting.length > 0);
}
