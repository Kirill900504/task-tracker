// Domain <-> Supabase row mapping, ported field-for-field from
// legacy-tracker.js's taskToRow/taskFromRow/meetingToRow/meetingFromRow/
// ideaToRow/ideaFromRow/sectionToRow/sectionFromRow. Deliberately not
// redesigned — the Telegram bot, cron jobs, and (until the cutover) the
// legacy UI all read/write these same columns, so the shape has to match
// exactly.
import type { Idea, Meeting, PanelLayout, Section, Task } from "@/types/tracker";

export type TaskRow = {
  id: string;
  title: string;
  description: string;
  assignee: string;
  priority: string;
  term: string;
  status: string;
  deadline: string | null;
  recur: string;
  recur_weekday: number | null;
  recur_monthday: number | null;
  recur_year_day: number | null;
  recur_year_month: number | null;
  last_completed_on: string | null;
  section_id: string | null;
  manual_order: number | null;
  completed_at: string | null;
};

export type MeetingRow = {
  id: string;
  date: string;
  time: string;
  title: string;
  participants: string[];
  status: string;
  result: string;
  moved_to_date: string | null;
  resolved_at: string | null;
};

export type IdeaRow = {
  id: string;
  text: string;
  important: boolean;
  done: boolean;
  created_at?: string;
  done_at: string | null;
};

export type SectionRow = {
  id: string;
  name: string;
  kind: string;
  sort_order: number;
};

// Normalizes a raw assignee/participant list (strings, `{name}`-like
// objects, or stray non-strings from a rough edit elsewhere) into deduped,
// trimmed strings — same defensive boundary check legacy-tracker.js applies
// everywhere assignee/participant data crosses from the database or a form.
export function sanitizeAssigneeList(list: unknown): string[] {
  const out: string[] = [];
  (Array.isArray(list) ? list : []).forEach((a) => {
    let name: string | null = null;
    if (typeof a === "string") name = a.trim();
    else if (a && typeof a === "object") {
      const o = a as Record<string, unknown>;
      name = String(o.name ?? o.title ?? o.label ?? o.assignee ?? "").trim();
    } else if (a !== null && a !== undefined) {
      name = String(a).trim();
    }
    if (name && !/^\[object .*\]$/i.test(name) && !out.includes(name)) out.push(name);
  });
  return out;
}

export function taskToRow(t: Task): TaskRow {
  return {
    id: t.id,
    title: t.title,
    description: t.desc || "",
    assignee: t.assignee || "",
    priority: t.priority,
    term: t.term,
    status: t.status,
    deadline: t.deadline || null,
    recur: t.recur || "none",
    recur_weekday: t.recurWeekday !== "" && t.recurWeekday != null ? Number(t.recurWeekday) : null,
    recur_monthday: t.recurMonthday !== "" && t.recurMonthday != null ? Number(t.recurMonthday) : null,
    recur_year_day: t.recurYearDay !== "" && t.recurYearDay != null ? Number(t.recurYearDay) : null,
    recur_year_month: t.recurYearMonth !== "" && t.recurYearMonth != null ? Number(t.recurYearMonth) : null,
    last_completed_on: t.lastCompletedOn || null,
    section_id: t.sectionId || null,
    manual_order: t.manualOrder != null && (t.manualOrder as unknown as string) !== "" ? Number(t.manualOrder) : null,
    completed_at: t.completedAt || null,
    // deleted_at is deliberately NOT part of this row — see softDeleteRow()/
    // restoreRow() in useTrackerData.ts for why an ordinary upsert must
    // never touch it.
  };
}

export function taskFromRow(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    desc: r.description || "",
    assignee: r.assignee || "",
    priority: (r.priority as Task["priority"]) || "med",
    term: (r.term as Task["term"]) || "short",
    status: (r.status as Task["status"]) || "in_progress",
    deadline: r.deadline || "",
    recur: (r.recur as Task["recur"]) || "none",
    recurWeekday: r.recur_weekday != null ? String(r.recur_weekday) : "1",
    recurMonthday: r.recur_monthday != null ? String(r.recur_monthday) : "",
    recurYearDay: r.recur_year_day != null ? String(r.recur_year_day) : "",
    recurYearMonth: r.recur_year_month != null ? String(r.recur_year_month) : "1",
    lastCompletedOn: r.last_completed_on || "",
    sectionId: r.section_id || "",
    manualOrder: r.manual_order != null ? r.manual_order : null,
    completedAt: r.completed_at || "",
  };
}

export function meetingToRow(m: Meeting): MeetingRow {
  return {
    id: m.id,
    date: m.date,
    time: m.time || "",
    title: m.title,
    participants: sanitizeAssigneeList(m.participants),
    status: m.status || "planned",
    result: m.result || "",
    moved_to_date: m.movedToDate || null,
    resolved_at: m.resolvedAt || null,
  };
}

export function meetingFromRow(r: MeetingRow): Meeting {
  return {
    id: r.id,
    date: r.date,
    time: r.time || "",
    title: r.title,
    participants: sanitizeAssigneeList(r.participants),
    status: (r.status as Meeting["status"]) || "planned",
    result: r.result || "",
    movedToDate: r.moved_to_date || "",
    resolvedAt: r.resolved_at || "",
  };
}

export function ideaToRow(i: Idea): IdeaRow {
  return { id: i.id, text: i.text, important: !!i.important, done: !!i.done, done_at: i.doneAt || null };
}

function pad(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

// Exported so client-side idea creation (a brand-new idea, not yet
// round-tripped through the database) can stamp the same "dd.mm.yyyy hh:mm"
// display string using the local Date it was created with, matching what
// ideaFromRow() would produce once the created_at column comes back.
export function formatIdeaCreatedAt(iso: string | Date | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ideaFromRow(r: IdeaRow): Idea {
  return { id: r.id, text: r.text, important: !!r.important, done: !!r.done, createdAt: formatIdeaCreatedAt(r.created_at), doneAt: r.done_at || "" };
}

export function sectionToRow(s: Section): SectionRow {
  return { id: s.id, name: s.name, kind: s.kind || "work", sort_order: s.sortOrder || 0 };
}

export function sectionFromRow(r: SectionRow): Section {
  return { id: r.id, name: r.name, kind: (r.kind as Section["kind"]) || "work", sortOrder: r.sort_order || 0 };
}

// Compares two layouts by content, zone by zone.
//
// Comparing JSON.stringify() output instead (which is what this replaced)
// quietly broke as soon as a layout came back from the database: panel_layout
// is a jsonb column, and Postgres stores jsonb with its own key order (by key
// length, so left/right/center) rather than the order it was written in. The
// stored layout could be identical to the default and still not match as a
// string — which is why "↺ Сбросить расположение" reappeared after every
// reload even though nothing had been rearranged.
export function sameLayout(a: PanelLayout | null | undefined, b: PanelLayout | null | undefined): boolean {
  if (!a || !b) return a === b;
  const zones: (keyof PanelLayout)[] = ["left", "center", "right"];
  return zones.every((zone) => {
    const x = a[zone] || [];
    const y = b[zone] || [];
    return x.length === y.length && x.every((panelId, i) => panelId === y[i]);
  });
}

export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  left: ["calPanel", "meetingsPanel"],
  center: ["mainCol"],
  right: ["ideasPanel"],
};

export const DEFAULT_ASSIGNEES: string[] = [
  "Кирилл (я)",
  "Игорь Витковский",
  "Юра Нодберг",
  "Евгений Макаров",
  "Станислав Синецкий",
  "Наталья Мамакова",
  "Михаил Иванов",
  "Котов Михаил",
  "Сергей Титов",
  "Юрий Черкашин",
  "Никита Долгов",
  "Наталья Есина",
  "Оксана Нишкомаева",
  "Сергей Головань",
  "Никита Козлов",
];
