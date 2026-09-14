"use client";

// Connecting the OWNER's own chat to the tracker — the button that appears
// only while there is nothing connected, since this is one-time setup and
// not something worth a permanent place in the header.
//
// Two messengers now, asked about separately: Telegram is always offered,
// MAX only where a MAX bot has actually been connected (see useMaxBot).
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useMaxBot } from "@/hooks/useMaxBot";
import { type ColleagueChannel } from "@/hooks/useColleagues";

export function useBotLink() {
  const [unlinked, setUnlinked] = useState<{ telegram: boolean; max: boolean }>({ telegram: false, max: false });
  const maxBot = useMaxBot();

  useEffect(() => {
    let cancelled = false;
    const db = createClient();
    async function check() {
      const [tg, max] = await Promise.all([
        db.from("telegram_accounts").select("telegram_chat_id").limit(1),
        db.from("max_accounts").select("max_user_id").limit(1),
      ]);
      if (cancelled) return;
      // Only offer linking when we know for sure nothing is linked yet — on
      // a query error, stay quiet rather than nag with a pointless button.
      setUnlinked({
        telegram: !tg.error && (!tg.data || tg.data.length === 0),
        max: !max.error && (!max.data || max.data.length === 0),
      });
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  // Собирается при отрисовке, а не в эффекте: «бот есть» и «чат не
  // привязан» приходят порознь и в разное время.
  const needs = { telegram: unlinked.telegram, max: maxBot.available && unlinked.max };

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
