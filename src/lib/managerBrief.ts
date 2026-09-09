import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDate } from "@/lib/taskDisplay";

// Утренняя сводка руководителю — та же услуга, что владелец получает с
// самого начала, только про его собственные дела.
//
// Написана кодом, без модели. У владельца сводку переписывает GigaChat,
// потому что у него их десятки и связный текст экономит внимание; здесь
// строк три-четыре, и цена ошибки другая: человек, которому написали
// «просрочено две», в тот же день скажет об этом на планёрке. Факт дешевле
// формулировки.

export type ManagerBriefFacts = {
  name: string;
  overdue: { title: string; deadline: string }[];
  today: { title: string; deadline: string }[];
  unanswered: { title: string }[];
  meetings: { title: string; time: string }[];
  returned: { title: string; comment: string }[];
};

export function managerBriefIsEmpty(f: ManagerBriefFacts): boolean {
  return !f.overdue.length && !f.today.length && !f.unanswered.length && !f.meetings.length && !f.returned.length;
}

export async function buildManagerBrief(
  admin: SupabaseClient,
  ownerId: string,
  assignee: { id: string; name: string },
  today: string,
): Promise<ManagerBriefFacts> {
  const facts: ManagerBriefFacts = {
    name: assignee.name,
    overdue: [],
    today: [],
    unanswered: [],
    meetings: [],
    returned: [],
  };

  const { data: rows } = await admin
    .from("task_participants")
    .select("role, accepted_at, done_at, declined_at, tasks(title, deadline, status, approval_state, approval_comment, deleted_at)")
    .eq("assignee_id", assignee.id)
    .eq("user_id", ownerId)
    .eq("role", "executor");

  type Row = {
    accepted_at: string | null;
    done_at: string | null;
    declined_at: string | null;
    tasks: {
      title: string;
      deadline: string | null;
      status: string | null;
      approval_state: string | null;
      approval_comment: string | null;
      deleted_at: string | null;
    } | null;
  };

  for (const r of ((rows || []) as unknown as Row[])) {
    const t = r.tasks;
    if (!t || t.deleted_at || r.done_at || t.status === "done") continue;
    const deadline = t.deadline || "";
    if (t.approval_state === "returned") facts.returned.push({ title: t.title, comment: t.approval_comment || "" });
    if (deadline && deadline < today) facts.overdue.push({ title: t.title, deadline });
    else if (deadline === today) facts.today.push({ title: t.title, deadline });
    if (!r.accepted_at && !r.declined_at) facts.unanswered.push({ title: t.title });
  }

  const { data: meetings } = await admin
    .from("meetings")
    .select("title, time, participants, status")
    .eq("user_id", ownerId)
    .eq("date", today)
    .is("deleted_at", null);

  for (const m of ((meetings || []) as { title: string; time: string; participants: string[]; status: string }[])) {
    if (m.status !== "planned") continue;
    if (!(m.participants || []).includes(assignee.name)) continue;
    facts.meetings.push({ title: m.title, time: m.time || "" });
  }
  facts.meetings.sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

  return facts;
}

export function composeManagerBrief(f: ManagerBriefFacts): string {
  const lines = [`Доброе утро, ${f.name}.`];

  // Порядок продиктован тем, что человек должен сделать раньше: сначала
  // то, что уже горит, потом сегодняшнее, потом то, где ждут его ответа.
  if (f.overdue.length) {
    lines.push("", "⚠ Просрочено:");
    for (const t of f.overdue) lines.push(`• ${t.title} — срок был ${fmtDate(t.deadline)}`);
  }
  if (f.today.length) {
    lines.push("", "Сегодня:");
    for (const t of f.today) lines.push(`• ${t.title}`);
  }
  if (f.returned.length) {
    lines.push("", "Вернули на доработку:");
    for (const t of f.returned) lines.push(`• ${t.title}${t.comment ? " — " + t.comment : ""}`);
  }
  if (f.unanswered.length) {
    lines.push("", "Ждут вашего ответа:");
    for (const t of f.unanswered) lines.push(`• ${t.title}`);
  }
  if (f.meetings.length) {
    lines.push("", "Встречи сегодня:");
    for (const m of f.meetings) lines.push(`• ${m.time ? m.time + " — " : ""}${m.title}`);
  }

  return lines.join("\n");
}
