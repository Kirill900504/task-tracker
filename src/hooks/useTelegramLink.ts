"use client";

// Port of the telegramLinkBtn handler from legacy-tracker.js: asks the server
// for a short-lived link code and shows it, then hides itself once an account
// is actually linked (this is one-time setup, not something worth a permanent
// header button).
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useTelegramLink() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const db = createClient();
    db.from("telegram_accounts")
      .select("telegram_chat_id")
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        // Only offer linking when we know for sure nothing is linked yet —
        // on a query error, stay quiet rather than nag with a button that
        // may be pointless.
        if (!error && (!data || data.length === 0)) setVisible(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const link = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram/link-code", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        alert("Не получилось: " + data.error);
        return;
      }
      const bot = data.botUsername ? "@" + data.botUsername : "боту";
      alert(`Откройте в Telegram ${bot} и отправьте:\n\n/start ${data.code}\n\nКод действует 15 минут.`);
    } catch (e) {
      alert("Не получилось: " + e);
    }
  }, []);

  return { visible, link };
}
