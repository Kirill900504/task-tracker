import type { SupabaseClient } from "@supabase/supabase-js";
import { gigaChatComplete } from "@/lib/gigachat/client";
import { moscowNow, dateStr, isOverdue, type TaskRow } from "@/lib/taskLogic";
import { rewriteIsFaithful } from "@/lib/factGuard";
import { tasksWord } from "@/lib/plural";

// Weekly review: the patterns you don't notice day to day — who is carrying
// too much, what has been sitting untouched for weeks, which meeting keeps
// getting pushed.
//
// Same division of labour as the daily brief: code counts, the model only
// puts the numbers into sentences. Nothing here asks it to work anything out.

const STALE_DAYS = 14;

export type WeeklyFacts = {
  weekStart: string;
  perAssignee: { name: string; open: number; overdue: number }[];
  stale: { title: string; assignee: string; daysUntouched: number }[];
  rescheduled: { title: string; times: number }[];
  closedLastWeek: number;
  createdLastWeek: number;
  totalOpen: number;
  totalOverdue: number;
};

type TaskFull = TaskRow & { priority?: string; updated_at?: string; created_at?: string; completed_at?: string | null };
type MeetingRow = { title: string; date: string; status: string; moved_to_date: string | null };

function daysSince(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.floor((nowMs - t) / 86400000);
}

export async function buildWeeklyFacts(admin: SupabaseClient, userId: string): Promise<WeeklyFacts> {
  const now = moscowNow();
  const nowMs = now.getTime();
  const today = dateStr(now);
  const weekAgoIso = new Date(nowMs - 7 * 86400000).toISOString();

  const [taskRes, meetingRes] = await Promise.all([
    admin
      .from("tasks")
      .select("id,title,assignee,status,deadline,priority,recur,recur_weekday,recur_monthday,recur_year_day,recur_year_month,updated_at,created_at,completed_at")
      .eq("user_id", userId)
      .is("deleted_at", null),
    admin.from("meetings").select("title,date,status,moved_to_date").eq("user_id", userId).is("deleted_at", null),
  ]);

  const all = (taskRes.data || []) as TaskFull[];
  const open = all.filter((t) => t.status !== "done");

  const byPerson = new Map<string, { open: number; overdue: number }>();
  for (const t of open) {
    const name = t.assignee || "(без исполнителя)";
    const e = byPerson.get(name) || { open: 0, overdue: 0 };
    e.open++;
    if (isOverdue(t, today)) e.overdue++;
    byPerson.set(name, e);
  }

  // "Sitting untouched": nothing about the task has changed in two weeks —
  // updated_at is bumped by any edit, so this really is "nobody has touched
  // it", not just "no deadline".
  const stale = open
    .map((t) => ({ title: t.title, assignee: t.assignee || "", daysUntouched: daysSince(t.updated_at, nowMs) }))
    .filter((t) => t.daysUntouched >= STALE_DAYS)
    .sort((a, b) => b.daysUntouched - a.daysUntouched)
    .slice(0, 5);

  // A meeting that was pushed leaves a resolved row with moved_to_date set,
  // and the follow-up carries the same title — so counting rows per title
  // counts how many times that conversation has been postponed.
  const pushes = new Map<string, number>();
  for (const m of (meetingRes.data || []) as MeetingRow[]) {
    if (m.moved_to_date) pushes.set(m.title, (pushes.get(m.title) || 0) + 1);
  }
  const rescheduled = [...pushes.entries()]
    .filter(([, times]) => times >= 2)
    .map(([title, times]) => ({ title, times }))
    .sort((a, b) => b.times - a.times)
    .slice(0, 5);

  return {
    weekStart: dateStr(new Date(nowMs - 7 * 86400000)),
    perAssignee: [...byPerson.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.open - a.open)
      .slice(0, 8),
    stale,
    rescheduled,
    closedLastWeek: all.filter((t) => t.status === "done" && t.completed_at && t.completed_at >= weekAgoIso).length,
    createdLastWeek: all.filter((t) => t.created_at && t.created_at >= weekAgoIso).length,
    totalOpen: open.length,
    totalOverdue: open.filter((t) => isOverdue(t, today)).length,
  };
}

export function weeklyIsEmpty(f: WeeklyFacts): boolean {
  return !f.totalOpen && !f.closedLastWeek && !f.createdLastWeek;
}

// Written from the facts here, for the same reason as the daily brief: on a
// first pass the model turned "заведено 3" into "новой активности не было".
// It only gets to reword this afterwards, and only if it leaves the numbers
// alone.
export function draftWeekly(f: WeeklyFacts): string {
  const lines: string[] = [`За неделю закрыто ${f.closedLastWeek}, заведено ${f.createdLastWeek}. Сейчас в работе ${f.totalOpen}, просрочено ${f.totalOverdue}.`];

  if (f.perAssignee.length) {
    const busiest = f.perAssignee[0];
    lines.push("Нагрузка:");
    for (const p of f.perAssignee.slice(0, 5)) {
      lines.push(`• ${p.name}: ${p.open} ${tasksWord(p.open)} в работе${p.overdue ? `, просрочено ${p.overdue}` : ""}`);
    }
    if (f.perAssignee.length > 1 && busiest.open >= 2 * (f.perAssignee[1]?.open || 0)) {
      lines.push(`Больше всех загружен ${busiest.name}.`);
    }
  }

  if (f.stale.length) {
    lines.push(`Без движения дольше ${STALE_DAYS} дней:`);
    for (const t of f.stale) lines.push(`• ${t.title}${t.assignee ? ` (${t.assignee})` : ""} — ${t.daysUntouched} дн.`);
  }

  if (f.rescheduled.length) {
    lines.push("Переносится из раза в раз:");
    for (const m of f.rescheduled) lines.push(`• ${m.title} — переносилась ${m.times} раз(а)`);
  }

  return lines.join("\n");
}

export async function composeWeekly(facts: WeeklyFacts): Promise<string> {
  const draft = draftWeekly(facts);
  // Names and titles the draft calls out must still be there afterwards.
  const mustMention = [...facts.perAssignee.slice(0, 5).map((p) => p.name), ...facts.stale.map((t) => t.title), ...facts.rescheduled.map((m) => m.title)].filter(
    (v) => draft.includes(v),
  );
  const system = [
    "Ты редактор. Ниже готовая недельная сводка по трекеру руководителя, собранная системой.",
    "Перепиши её живым человеческим языком, сохранив ВСЕ факты.",
    "",
    "Строго запрещено:",
    "- менять или добавлять числа, имена и названия;",
    "- добавлять выводы и наблюдения, которых нет в тексте;",
    "- давать советы «как управлять».",
    "",
    "Можно: переформулировать и объединить строки. Без markdown и заголовков, не больше 8 строк.",
    "Если сомневаешься — оставь как есть.",
  ].join("\n");

  let text = draft;
  try {
    const raw = await gigaChatComplete({ system, user: draft, temperature: 0.2 });
    const candidate = raw.trim();
    if (rewriteIsFaithful(draft, candidate, mustMention)) text = candidate;
  } catch {
    // Model unavailable — the draft stands on its own.
  }
  return "📊 Итоги недели. " + (text.length > 3500 ? text.slice(0, 3500) + "…" : text);
}
