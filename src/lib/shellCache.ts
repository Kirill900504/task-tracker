"use client";

// Must match CACHE in public/sw.js — the worker serves what is put here when
// the network is gone. Not a style rule: the worker's activate() deletes
// every cache that is not its own, so a name that has drifted by one
// character means it wipes this shell moments after the page writes it, and
// the tracker stops opening offline at all. That happened on 19.09.2026,
// from bumping the version on one side only. `serviceWorker.test.ts` reads
// both files and fails if they disagree.
const SHELL_CACHE = "rokas-shell-v2";

// Forget the stored shell ("/" and the mini-app entry "/app").
//
// The worker answers those two addresses from this cache FIRST (public/sw.js,
// since 14.10.2026), so a shell whose build files are gone would fail the
// same way on every start: «Открыть заново» would reopen exactly the copy that
// just broke. Vercel keeps old builds' files, so this should not happen in
// production — but a missing chunk is precisely the failure nobody can
// recover from by hand, so global-error drops the copy and reloads.
export async function dropShell(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all([cache.delete("/", { ignoreVary: true }), cache.delete("/app", { ignoreVary: true })]);
  } catch {
    /* nothing to drop */
  }
}

// A failed import of a build file — the one crash a reload from the network
// cures and a reload from the cache does not.
export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  return !!e && (e.name === "ChunkLoadError" || /Failed to load chunk|Loading chunk .* failed|dynamically imported module/i.test(e.message || ""));
}

// Puts the application shell into the service worker's cache, so the tracker
// opens without a connection.
//
// Two things make this the page's job rather than the worker's:
//
// 1. A fetch the worker makes for "/" comes back as a redirect to the
//    sign-in page — it does not carry the session the way a request from the
//    page does. A redirected response can never answer a navigation: the
//    browser refuses it, and the page then fails to open offline at all.
// 2. It has to happen while signed in and on the tracker itself. The very
//    first load of the app is the sign-in page, and moving from there to the
//    tracker is a client-side navigation that never remounts the layout — so
//    anything that only runs once, at the root, only ever sees /login.
//
// Called after a successful load, when the shell is known to be both valid
// and the build that is actually deployed.
export async function cacheShell(): Promise<void> {
  try {
    if (typeof caches === "undefined" || !("serviceWorker" in navigator)) return;
    const response = await fetch("/", { credentials: "same-origin" });
    if (!response.ok || response.redirected) return;
    const cache = await caches.open(SHELL_CACHE);
    await cache.put("/", response.clone());
  } catch {
    /* no connection, or storage refused — whatever was cached before stands */
  }
}
