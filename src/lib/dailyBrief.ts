import type { SupabaseClient } from "@supabase/supabase-js";
import { gigaChatComplete } from "@/lib/gigachat/client";
import { moscowNow, dateStr, isDueToday, isOverdue, type TaskRow } from "@/lib/taskLogic";
import { rewriteIsFaithful } from "@/lib/factGuard";
import { tasksWord } from "@/lib/plural";

// The morning briefing: instead of "17 задач просрочено", say what actually
// matters today and why — "сегодня главное вот эти три, потому что завтра по
// этому встреча / человек ждёт / срок был неделю назад".
//
// Every fact and every number here is computed in code. The model only turns
// the prepared facts into a short readable note; it is never asked to count,
// compare dates, or decide what is overdue. Its job is wording, so a wrong
// answer can be clumsy but not false.

type BriefTask = {
  title: string;
  assignee: string;
  deadline: string;
  priority: string;
  daysOverdue: number;
  hasMeetingSoon: boolean;
};

export type BriefFacts = {
  today: string;
  overdue: BriefTask[];
  dueToday: BriefTask[];
  meetingsToday: { title: string; time: string; participants: string[] }[];
  meetingsTomorrow: { title: string; time: string; participants: string[] }[];
  totalOpen: number;
};

type MeetingRow = { title: string; date: string; time: string; participants: string[] | null; status: string };

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + "T00:00:00Z");
  const b = Date.parse(toIso + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

// A task counts as "обсуждается на ближайшей встрече" when a word from its
// title shows up in a meeting's title, or the person responsible for it is in
// that meeting. Deliberately a rough match — it only ever adds a reason to
// the briefing, never hides anything.
function relatesToMeeting(task: BriefTask, meetings: MeetingRow[]): boolean {
  const words = task.title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 5);
  return meetings.some((m) => {
    const title = m.title.toLowerCase();
    if (words.some((w) => title.includes(w))) return true;
    return !!task.assignee && (m.participants || []).includes(task.assignee);
  });
}

export async function buildBriefFacts(admin: SupabaseClient, userId: string): Promise<BriefFacts> {
  const now = moscowNow();
  const today = dateStr(now);
  const tomorrow = dateStr(new Date(now.getTime() + 86400000));

  const [taskRes, meetingRes] = await Promise.all([
    admin
      .from("tasks")
      .select("id,title,assignee,status,deadline,priority,recur,recur_weekday,recur_monthday,recur_year_day,recur_year_month")
      .eq("user_id", userId)
      .is("deleted_at", null),
    admin
      .from("meetings")
      .select("title,date,time,participants,status")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("date", [today, tomorrow]),
  ]);

  const allTasks = (taskRes.data || []) as (TaskRow & { priority?: string })[];
  const open = allTasks.filter((t) => t.status !== "done");
  const meetings = ((meetingRes.data || []) as MeetingRow[]).filter((m) => !m.status || m.status === "planned");
  const meetingsToday = meetings.filter((m) => m.date === today);
  const meetingsTomorrow = meetings.filter((m) => m.date === tomorrow);
  const soon = [...meetingsToday, ...meetingsTomorrow];

  const toBrief = (t: TaskRow & { priority?: string }): BriefTask => {
    const base: BriefTask = {
      title: t.title,
      assignee: t.assignee || "",
      deadline: t.deadline || "",
      priority: t.priority || "med",
      daysOverdue: t.deadline && isOverdue(t, today) ? daysBetween(t.deadline, today) : 0,
      hasMeetingSoon: false,
    };
    base.hasMeetingSoon = relatesToMeeting(base, soon);
    return base;
  };

  return {
    today,
    overdue: open.filter((t) => isOverdue(t, today)).map(toBrief),
    dueToday: open.filter((t) => !isOverdue(t, today) && isDueToday(t, now, today)).map(toBrief),
    meetingsToday: meetingsToday.map((m) => ({ title: m.title, time: m.time || "", participants: m.participants || [] })),
    meetingsTomorrow: meetingsTomorrow.map((m) => ({ title: m.title, time: m.time || "", participants: m.participants || [] })),
    totalOpen: open.length,
  };
}

// True when there is nothing worth writing about — the caller skips the
// message entirely rather than sending "сегодня ничего".
export function briefIsEmpty(f: BriefFacts): boolean {
  return !f.overdue.length && !f.dueToday.length && !f.meetingsToday.length;
}

// Ranking is code's job, not the model's: most-overdue first, then anything
// tied to a meeting in the next day, then explicitly high priority.
function rank(t: BriefTask): number {
  return t.daysOverdue * 10 + (t.hasMeetingSoon ? 5 : 0) + (t.priority === "high" ? 3 : 0) + (t.deadline ? 1 : 0);
}

function reasonFor(t: BriefTask): string {
  if (t.daysOverdue > 0) return `срок был ${t.daysOverdue} дн. назад`;
  if (t.hasMeetingSoon) return "по этой теме встреча в ближайший день";
  if (t.priority === "high") return "высокий приоритет";
  return "срок сегодня";
}

// The briefing itself is assembled here, from facts, so every name, number
// and date in it is correct by construction. The model is only asked to
// smooth the wording afterwards (see composeBrief) — and if it changes any
// number, this version is what gets sent instead.
export function draftBrief(f: BriefFacts): string {
  const top = [...f.overdue, ...f.dueToday].sort((a, b) => rank(b) - rank(a)).slice(0, 3);
  const lines: string[] = [];

  if (top.length) {
    lines.push(top.length === 1 ? "Главное на сегодня:" : `Главное на сегодня (${top.length}):`);
    for (const t of top) {
      lines.push(`• ${t.title}${t.assignee ? ` — ${t.assignee}` : ""} (${reasonFor(t)})`);
    }
  }

  const rest = f.overdue.length + f.dueToday.length - top.length;
  if (rest > 0) lines.push(`Ещё ${rest} на сегодня и просроченных, всего в работе ${f.totalOpen} ${tasksWord(f.totalOpen)}.`);
  else if (f.totalOpen > top.length) lines.push(`Всего в работе ${f.totalOpen} ${tasksWord(f.totalOpen)}.`);

  if (f.meetingsToday.length) {
    lines.push("Встречи сегодня:");
    for (const m of f.meetingsToday) {
      lines.push(`• ${m.time || "время не указано"} — ${m.title}${m.participants.length ? " (" + m.participants.join(", ") + ")" : ""}`);
    }
  }
  return lines.join("\n");
}

export async function composeBrief(facts: BriefFacts): Promise<string> {
  const draft = draftBrief(facts);
  // The titles named in the draft have to survive the rewrite: dropping them
  // for "задача Никиты Козлова" loses the one thing the briefing is for.
  const titles = [...facts.overdue, ...facts.dueToday].map((t) => t.title).filter((t) => draft.includes(t));
  const system = [
    "Ты редактор. Ниже готовая утренняя сводка для руководителя, собранная системой.",
    "Перепиши её живым человеческим языком, сохранив ВСЕ факты.",
    "",
    "Строго запрещено:",
    "- менять или добавлять числа, даты, имена и названия задач;",
    "- добавлять дела, встречи или причины, которых нет в тексте;",
    "- давать советы и оценки от себя.",
    "",
    "Можно: переформулировать, объединить строки, убрать канцелярит. Без markdown и заголовков, не больше 8 строк.",
    "Если сомневаешься — оставь как есть.",
  ].join("\n");

  let text = draft;
  try {
    const raw = await gigaChatComplete({ system, user: draft, temperature: 0.2 });
    const candidate = raw.trim();
    if (rewriteIsFaithful(draft, candidate, titles)) text = candidate;
  } catch {
    // Model unavailable — the draft is a complete briefing on its own.
  }
  return "☀️ Утро. " + (text.length > 3500 ? text.slice(0, 3500) + "…" : text);
}
