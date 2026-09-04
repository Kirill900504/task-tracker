"use client";

// Port of checkSyncErrors() from legacy-tracker.js. A save that failed in a
// *previous* session left only a toast, long gone by the time the tab is
// reopened — so unacknowledged sync_errors rows are surfaced here as a
// dismissable banner instead, listing how many and the most recent message.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SyncErrorBanner() {
  const [errors, setErrors] = useState<{ ids: string[]; count: number; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const db = createClient();
    db.from("sync_errors")
      .select("id, message, created_at")
      .eq("acknowledged", false)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled || error || !data || !data.length) return;
        setErrors({ ids: data.map((r) => r.id as string), count: data.length, message: (data[0].message as string) || "" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!errors) return null;

  function dismiss() {
    if (!errors) return;
    const db = createClient();
    db.from("sync_errors").update({ acknowledged: true }).in("id", errors.ids).then(() => {});
    setErrors(null);
  }

  return (
    <div className="notif-banner show" id="syncErrorBanner" style={{ display: "flex" }}>
      <span>
        ⚠ Не всё сохранилось в облако ({errors.count}): {errors.message}
      </span>
      <button className="btn btn-small" style={{ marginLeft: 10 }} onClick={dismiss}>
        Скрыть
      </button>
    </div>
  );
}
