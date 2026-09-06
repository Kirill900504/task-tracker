"use client";

import { useEffect } from "react";

// Registers the service worker that caches the application shell (see
// public/sw.js), which is what lets the tracker open without a connection.
//
// This used to run at module scope, on window's "load" event. That is a
// race: by the time React hydrates this component the page has often
// finished loading already, the event never fires again, and the worker is
// never registered at all. Doing it from an effect on mount has no such
// window to miss.
export default function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Not in development. The worker serves build assets cache-first, and
    // dev chunk URLs are not content-hashed the way production's are — so an
    // edited file keeps being served from the cache, and you end up debugging
    // yesterday's code. Anything registered by an earlier run is removed too,
    // or it would go on serving that stale copy on its own.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      });
      if (typeof caches !== "undefined") {
        void caches.keys().then((names) => {
          for (const name of names) void caches.delete(name);
        });
      }
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* an unavailable worker only costs offline support, never the app */
    });
    // The shell itself is cached from the tracker page once it has loaded —
    // see src/lib/shellCache.ts for why it cannot be done from here.
  }, []);
  return null;
}
