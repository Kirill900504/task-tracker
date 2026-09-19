import type { Idea, Meeting, Section, Task } from "@/types/tracker";
import { fmtDate } from "@/lib/taskDisplay";

// Taking your own data out of the tracker: everything at once as JSON (the
// shape it is actually stored in, so it can be read back or handed to
// anything else), or one list at a time as CSV for a spreadsheet.
//
// The weekly Telegram backup covers "something went wrong"; this covers
// wanting the data in your hands right now, without asking anyone.

export type ExportBundle = {
  exportedAt: string;
  tasks: Task[];
  meetings: Meeting[];
  ideas: Idea[];
  sections: Section[];
  assignees: string[];
};

export function buildJson(bundle: Omit<ExportBundle, "exportedAt">): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), ...bundle }, null, 2);
}

// Excel on a Russian Windows reads a comma-separated file as one column —
// the list separator there is a semicolon — and shows Cyrillic as mojibake
// without a byte-order mark. Both are fixed here rather than in a "how to
// open this" note nobody reads.
const SEP = ";";
const BOM = "﻿";

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // A cell is quoted when it contains the separator, a quote or a line break;
  // quotes inside are doubled. Same rules Excel writes.
  if (!/[";\n\r]/.test(text)) return text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.join(SEP), ...rows.map((row) => row.map(csvCell).join(SEP))];
  // CRLF: what Excel expects, and harmless everywhere else.
  return BOM + lines.join("\r\n");
}

function priorityLabel(p: Task["priority"]): string {
  return p === "high" ? "Высокий" : "Средний";
}

export function tasksCsv(tasks: Task[], sections: Section[]): string {
  const sectionName = (id: string) => sections.find((s) => s.id === id)?.name || "";
  return toCsv(
    ["Задача", "Описание", "Исполнитель", "Раздел", "Приоритет", "Срок", "Тип", "Статус", "Повтор", "Завершена"],
    tasks.map((t) => [
      t.title,
      t.desc,
      t.assignee,
      sectionName(t.sectionId),
      priorityLabel(t.priority),
      fmtDate(t.deadline),
      t.term === "long" ? "Долгосрочная" : "Краткосрочная",
      t.status === "done" ? "Завершена" : "В работе",
      t.recur === "none" ? "" : t.recur,
      t.completedAt ? fmtDate(t.completedAt.slice(0, 10)) : "",
    ]),
  );
}

export function meetingsCsv(meetings: Meeting[]): string {
  const statusLabel = (m: Meeting) =>
    m.status === "success" ? "Успешно" : m.status === "no_result" ? "Без результата" : "Запланирована";
  return toCsv(
    ["Дата", "Время", "Встреча", "Участники", "Статус", "Итог", "Перенесена на"],
    meetings.map((m) => [fmtDate(m.date), m.time, m.title, (m.participants || []).join(", "), statusLabel(m), m.result, fmtDate(m.movedToDate)]),
  );
}

export function ideasCsv(ideas: Idea[]): string {
  return toCsv(
    ["Мысль", "Важная", "Отмечена", "Создана"],
    ideas.map((i) => [i.text, i.important ? "да" : "", i.done ? "да" : "", i.createdAt]),
  );
}

// A name that sorts by date and says what is inside: rokas-задачи-2026-09-06.csv
export function exportFileName(what: string, extension: string): string {
  const now = new Date();
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `rokas-${what}-${stamp}.${extension}`;
}
