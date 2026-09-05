// Domain types for the tracker's data layer. These mirror the shapes
// legacy-tracker.js has used in Supabase since Stage 1 — kept 1:1 with it
// (taskFromRow/meetingFromRow/ideaFromRow/sectionFromRow) rather than
// redesigned, so the new UI reads/writes the exact same rows the legacy UI,
// the Telegram bot, and the cron jobs already agree on.

export type Priority = "high" | "med";
export type Term = "short" | "long";
export type TaskStatus = "in_progress" | "done";
export type RecurKind = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type MeetingStatus = "planned" | "success" | "no_result";
export type SectionKind = "work" | "personal";

export interface Task {
  id: string;
  title: string;
  desc: string;
  assignee: string;
  sectionId: string;
  priority: Priority;
  term: Term;
  status: TaskStatus;
  deadline: string; // YYYY-MM-DD or ""
  recur: RecurKind;
  recurWeekday: string; // "0"-"6"
  recurMonthday: string;
  recurYearDay: string;
  recurYearMonth: string; // "1"-"12"
  lastCompletedOn: string; // YYYY-MM-DD or ""
  manualOrder: number | null;
  // ISO timestamp of when the task was last marked done ("" while open).
  // Drives the "most recently closed first" order of the завершённые list.
  completedAt: string;
}

export interface Meeting {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM or ""
  title: string;
  participants: string[];
  status: MeetingStatus;
  result: string;
  movedToDate: string;
  // ISO timestamp of when the meeting was closed (success/no_result), ""
  // while it is still planned.
  resolvedAt: string;
}

export interface Idea {
  id: string;
  text: string;
  important: boolean;
  done: boolean;
  createdAt: string; // formatted "dd.mm.yyyy hh:mm", display-only
  // ISO timestamp of when the idea was ticked off ("" while active).
  doneAt: string;
}

export interface Section {
  id: string;
  name: string;
  kind: SectionKind;
  sortOrder: number;
}

export type Assignee = string;

// Partial pre-fill for opening a "new task"/"new meeting" modal already
// populated — used by both the calendar's date-popover (deadline/date only)
// and QuickAdd's desktop flow (full parsed fields) under the new UI.
export interface TaskPrefill {
  title?: string;
  desc?: string;
  assignee?: string;
  priority?: Priority;
  term?: Term;
  deadline?: string;
}

export interface MeetingPrefill {
  title?: string;
  date?: string;
  time?: string;
  participants?: string[];
}

export interface PanelLayout {
  left: string[];
  center: string[];
  right: string[];
}
