// Pure, framework-free sync primitives — split out so they're unit-testable
// without a database, a network, or React. This is the same diff-against-a-
// cloned-shadow design as legacy-tracker.js's diffAndSync()/snapshotList(),
// ported faithfully rather than redesigned (see the comments in
// public/legacy-tracker.js around those functions for the full history of
// why each piece exists — most importantly: why the shadow must be a deep
// clone, not just a new array of the same object references).

export interface WithId {
  id: string;
}

// Deep-clones each item. Storing shadow as `list.slice()` (a new array, same
// object references) let an in-place edit on a live object retroactively
// "pre-sync" its own shadow copy — sameJson() would then see no difference
// and the edit would never be sent to the database at all. This is the fix
// for that bug (see public/legacy-tracker.js, function snapshotList).
export function snapshotList<T>(list: T[]): T[] {
  return list.map((x) => JSON.parse(JSON.stringify(x)) as T);
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface DiffResult<R> {
  upserts: R[];
  deleteIds: string[];
}

// Computes exactly what changed between `current` and `shadow` (the last
// known-synced snapshot), row-shaped via `toRow`. A row is only included in
// `upserts` if it's new or its row shape actually differs from shadow's —
// this is what makes persistAll() cheap to call after every keystroke/click
// without spamming the database with unchanged rows.
export function diffRows<T extends WithId, R>(current: T[], shadow: T[], toRow: (x: T) => R): DiffResult<R> {
  const byIdCurrent = new Map(current.map((x) => [x.id, x]));
  const byIdShadow = new Map(shadow.map((x) => [x.id, x]));

  const upserts: R[] = [];
  for (const x of current) {
    const prev = byIdShadow.get(x.id);
    if (!prev || !sameJson(toRow(x), toRow(prev))) upserts.push(toRow(x));
  }
  const deleteIds = shadow.filter((x) => !byIdCurrent.has(x.id)).map((x) => x.id);
  return { upserts, deleteIds };
}

// Assignees are plain strings (no id column), so they diff by value instead.
export function diffAssignees(current: string[], shadow: string[]): { added: string[]; removed: string[] } {
  const currentSet = new Set(current);
  const shadowSet = new Set(shadow);
  return {
    added: current.filter((name) => !shadowSet.has(name)),
    removed: shadow.filter((name) => !currentSet.has(name)),
  };
}

// Immutable list helpers for React state updates (legacy-tracker.js's
// upsertById()/removeById() mutate a shared array in place — not safe with
// React state, which must be replaced, not mutated, on every change).
export function upsertById<T extends WithId>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

export function removeById<T extends WithId>(list: T[], id: string): T[] {
  return list.filter((x) => x.id !== id);
}
