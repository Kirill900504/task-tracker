"use client";

// Connecting the OWNER's own chat to the tracker — the button that appears
// only while there is nothing connected, since this is one-time setup and
// not something worth a permanent place in the header.
//
// Two messengers now, asked about separately: Telegram is always offered,
// MAX only where a MAX bot exists for this install (see MAX_AVAILABLE).
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MAX_AVAILABLE, type ColleagueChannel } from "@/hooks/useColleagues";

export function useBotLink() {
  const [needs, setNeeds] = useState<{ telegram: boolean; max: boolean }>({ telegram: false, max: false });

  useEffect(() => {
    let cancelled = false;
    const db = createClient();
    async function check() {
      const [tg, max] = await Promise.all([
        db.from("telegram_accounts").select("telegram_chat_id").limit(1),
        MAX_AVAILABLE ? db.from("max_accounts").select("max_user_id").limit(1) : Promise.resolve({ data: [{}], error: null }),
      ]);
      if (cancelled) return;
      // Only offer linking when we know for sure nothing is linked yet — on
      // a query error, stay quiet rather than nag with a pointless button.
      setNeeds({
        telegram: !tg.error && (!tg.data || tg.data.length === 0),
        max: MAX_AVAILABLE && !max.error && (!max.data || max.data.length === 0),
      });
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  const link = useCallback(async (channel: ColleagueChannel) => {
    try {
      const res = await fetch("/api/telegram/link-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      if (data.error) {
        alert("Не получилось: " + data.error);
        return;
      }
      const where = channel === "max" ? "MAX" : "Telegram";
      alert(
        `Откройте бота в ${where} и отправьте:\n\n/start ${data.code}\n\n` +
          (data.link ? `Или просто перейдите по ссылке:\n${data.link}\n\n` : "") +
          "Код действует 15 минут.",
      );
    } catch (e) {
      alert("Не получилось: " + e);
    }
  }, []);

  return { needs, link };
}
