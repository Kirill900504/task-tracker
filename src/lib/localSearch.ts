import type { Idea, Meeting, Task } from "@/types/tracker";
import { stem, sharesPrefix } from "@/lib/stem";
import { fmtDate } from "@/lib/taskDisplay";

// Search across everything already on screen — tasks (with descriptions),
// meetings (with their outcomes) and ideas. It runs against the data the
// tracker has in memory, so it costs nothing, needs no round trip, and
// updates as you type. The bot's own search (trackerSearch.ts) is the same
// idea against the database, for when you are asking from the phone.
//
// Matching is by word opening, not exact text: «склад» finds «склады» and
// «складу», «Севастоп» finds «Севастополе». Several words narrow rather than
// widen — «склад севастополь» only matches items where both appear.

export type SearchKind = "task" | "meeting" | "idea";

export type SearchResult = {
  kind: SearchKind;
  id: string;
  title: string;
  meta: string;
  done: boolean;
};

const STOPWORDS = new Set(["что", "как", "где", "все", "всё", "про", "для", "мне", "или", "там", "это"]);

export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stem);
}

function wordMatches(hayWord: string, term: string): boolean {
  return hayWord.startsWith(term) || sharesPrefix(hayWord, term, 4);
}

export function matchesTerms(haystack: string, terms: string[]): boolean {
  if (!terms.length) return false;
  const words = haystack.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const stems = words.map(stem);
  // Every word of the query has to be found somewhere in the item — typing
  // more words should narrow the list down, not open it up.
  return terms.every((t) => words.some((w) => wordMatches(w, t)) || stems.some((w) => wordMatches(w, t)));
}

function taskMeta(t: Task): string {
  const bits: string[] = [];
  if (t.assignee) bits.push(t.assignee);
  if (t.deadline) bits.push(fmtDate(t.deadline));
  if (t.status === "done") bits.push("завершена");
  return bits.join(" · ");
}

function meetingMeta(m: Meeting): string {
  const bits = [fmtDate(m.date) + (m.time ? ", " + m.time : "")];
  if (m.status === "success") bits.push("успешно");
  else if (m.status === "no_result") bits.push("без результата");
  if (m.participants?.length) bits.push(m.participants.join(", "));
  return bits.join(" · ");
}

export function searchAll(
  query: string,
  data: { tasks: Task[]; meetings: Meeting[]; ideas: Idea[] },
  limitPerKind = 8,
): SearchResult[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];

  const results: SearchResult[] = [];

  const tasks = data.tasks
    .filter((t) => matchesTerms([t.title, t.desc, t.assignee].filter(Boolean).join(" "), terms))
    // Open work first: what you are searching for is usually still to be done.
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done"))
    .slice(0, limitPerKind);
  for (const t of tasks) {
    results.push({ kind: "task", id: t.id, title: t.title, meta: taskMeta(t), done: t.status === "done" });
  }

  const meetings = data.meetings
    .filter((m) => matchesTerms([m.title, m.result, (m.participants || []).join(" ")].filter(Boolean).join(" "), terms))
    .sort((a, b) => {
      const resolved = Number(!!a.status && a.status !== "planned") - Number(!!b.status && b.status !== "planned");
      return resolved !== 0 ? resolved : b.date.localeCompare(a.date);
    })
    .slice(0, limitPerKind);
  for (const m of meetings) {
    results.push({ kind: "meeting", id: m.id, title: m.title, meta: meetingMeta(m), done: !!m.status && m.status !== "planned" });
  }

  const ideas = data.ideas
    .filter((i) => matchesTerms(i.text, terms))
    .sort((a, b) => Number(a.done) - Number(b.done))
    .slice(0, limitPerKind);
  for (const i of ideas) {
    results.push({ kind: "idea", id: i.id, title: i.text, meta: i.createdAt || "", done: !!i.done });
  }

  return results;
}

export const KIND_LABELS: Record<SearchKind, string> = {
  task: "Задачи",
  meeting: "Встречи",
  idea: "Мысли",
};
