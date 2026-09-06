import { sameJson, type WithId } from "@/lib/trackerSync";

// What happens to changes made while the tab was offline (or closed before a
// save landed).
//
// The tracker keeps two lists: what is on screen ("live") and what was last
// confirmed as written to the database ("shadow"). The difference between
// them IS the unsent work — the same difference persistAll() pushes. So when
// the app starts and finds a cached copy of both, it can tell exactly what
// the user changed while away and re-apply it on top of whatever the server
// says now, instead of either losing those edits or blindly overwriting the
// server with a stale snapshot.
//
// The rule per item: only what the user actually touched wins over the
// server. Everything untouched comes from the server — including rows
// changed on another device in the meantime.

export function applyLocalChanges<T extends WithId>(server: T[], cachedLive: T[], cachedShadow: T[]): T[] {
  const liveById = new Map(cachedLive.map((x) => [x.id, x]));
  const shadowById = new Map(cachedShadow.map((x) => [x.id, x]));

  const locallyDeleted = new Set<string>();
  for (const old of cachedShadow) {
    if (!liveById.has(old.id)) locallyDeleted.add(old.id);
  }

  const result: T[] = [];
  const seen = new Set<string>();

  for (const row of server) {
    if (locallyDeleted.has(row.id)) continue;
    seen.add(row.id);
    const live = liveById.get(row.id);
    const shadow = shadowById.get(row.id);
    // Edited offline (live differs from what was last synced) — the local
    // version stands. Otherwise the server's row is the newer truth.
    if (live && shadow && !sameJson(live, shadow)) result.push(live);
    else result.push(row);
  }

  // Created offline: never seen by the server at all.
  for (const live of cachedLive) {
    if (seen.has(live.id)) continue;
    if (shadowById.has(live.id)) continue; // known to the server, but deleted there — leave it deleted
    result.push(live);
  }

  return result;
}

// Assignees are plain strings with no id, so they merge by membership:
// added offline are kept, removed offline are dropped, and anything the
// server has that was never touched locally stays.
export function applyLocalNameChanges(server: string[], cachedLive: string[], cachedShadow: string[]): string[] {
  const liveSet = new Set(cachedLive);
  const shadowSet = new Set(cachedShadow);
  const addedOffline = cachedLive.filter((n) => !shadowSet.has(n));
  const removedOffline = new Set(cachedShadow.filter((n) => !liveSet.has(n)));

  const result = server.filter((n) => !removedOffline.has(n));
  for (const name of addedOffline) {
    if (!result.includes(name)) result.push(name);
  }
  return result;
}

// True when the cached copy holds work that never reached the database —
// used to decide whether a merge is needed at all, and to tell the user.
export function hasUnsyncedWork(live: Record<string, unknown[]>, shadow: Record<string, unknown[]>): boolean {
  for (const key of Object.keys(live)) {
    if (!sameJson(live[key], shadow[key])) return true;
  }
  return false;
}
