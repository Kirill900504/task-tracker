"use client";

// Must match CACHE in public/sw.js — the worker serves what is put here when
// the network is gone.
const SHELL_CACHE = "rokas-shell-v2";

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
