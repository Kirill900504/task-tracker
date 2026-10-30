"use client";

import { useEffect } from "react";
import { saveSnapshot, setSnapshotOwner } from "@/lib/bootSnapshot";

// Keeps the picture the next start opens on (lib/bootSnapshot) up to date.
//
// Saved when the window is left — hidden, closed, minimised: that is the
// last screen the person saw, and the moment nobody is waiting for a click.
// Plus once a minute in idle time, because the desktop window is often never
// hidden at all and still gets reloaded by VersionWatch (which saves a fresh
// copy itself right before it reloads).
export function useBootSnapshot(ready: boolean, userId: string) {
  useEffect(() => {
    if (!ready || !userId) return;
    setSnapshotOwner(userId);
    // The real screen is up; the restore's marker has done its job.
    document.documentElement.classList.remove("boot-snap");
    const onHide = () => {
      if (document.visibilityState === "hidden") saveSnapshot();
    };
    const idle = (cb: () => void) =>
      typeof requestIdleCallback === "function" ? requestIdleCallback(cb, { timeout: 5000 }) : setTimeout(cb, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") idle(saveSnapshot);
    }, 60_000);
    // First copy a few seconds in, once the network catch-up has redrawn the
    // board — so even a window reloaded in its first minute has one.
    const first = setTimeout(() => idle(saveSnapshot), 4000);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", saveSnapshot);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", saveSnapshot);
      setSnapshotOwner("");
    };
  }, [ready, userId]);
}
