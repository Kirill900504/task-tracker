"use client";

// Port of legacy-tracker.js's setSyncStatus(text, autoHide): "Сохраняю…" and
// error messages stay on screen, a finished save shows "✓ Сохранено" and then
// hides itself after 2s.
//
// The caller remounts this with a fresh `key` on every status change, so the
// hidden flag resets without an effect writing state on each render — the only
// setState left here runs from the timer callback.
import { useEffect, useState } from "react";

export default function SyncStatusPill({ text, autoHide }: { text: string; autoHide: boolean }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!autoHide) return;
    const timer = setTimeout(() => setHidden(true), 2000);
    return () => clearTimeout(timer);
  }, [autoHide]);

  return (
    <div id="syncStatus" className={hidden ? "" : "show"}>
      {text}
    </div>
  );
}
