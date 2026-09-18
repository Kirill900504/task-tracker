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
import { useAsk } from "@/components/Ask";

export function useBotLink() {
  const ask = useAsk();
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
    // Та же причина, что и у руководителя (useMyMessenger): привязка
    // случается в другом приложении, человек возвращается на вкладку — и
    // кнопка «🔗 Telegram» обязана исчезнуть сама, а не висеть до
    // перезагрузки, намекая, что ничего не вышло.
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Собирается при отрисовке, а не в эффекте: «бот есть» и «чат не
  // привязан» приходят порознь и в разное время.
  const needs = { telegram: unlinked.telegram, max: maxBot.available && unlinked.max };

  const link = useCallback(
    async (channel: ColleagueChannel) => {
      const where = channel === "max" ? "MAX" : "Telegram";
      try {
        const res = await fetch("/api/telegram/link-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel }),
        });
        const data = await res.json();
        if (data.error) {
          await ask.say({ title: "Не получилось", question: String(data.error) });
          return;
        }
        // Ссылка кнопкой, код — отдельной строкой, как у руководителя на его
        // экране: раньше здесь было системное окно браузера, в котором и
        // ссылка, и код были обычным текстом посреди абзаца.
        await ask.say({
          title: `Подключение ${where}`,
          question: data.link ? "Откройте бота и нажмите «Начать»." : `Откройте бота в ${where} и отправьте ему это сообщение:`,
          note: data.link
            ? `Если ссылка не открылась — отправьте боту это сообщение. Код действует 15 минут.`
            : "Код действует 15 минут.",
          link: data.link ? { href: data.link as string, label: `Открыть ${where} →` } : undefined,
          code: `/start ${data.code}`,
          okText: "Готово",
        });
      } catch (e) {
        await ask.say({ title: "Не получилось", question: e instanceof Error ? e.message : String(e) });
      }
    },
    [ask],
  );

  return { needs, link };
}
