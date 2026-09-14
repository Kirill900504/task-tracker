"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Есть ли в этой установке бот MAX — и как он называется.
//
// Раньше это была переменная сборки (NEXT_PUBLIC_MAX_BOT_USERNAME), и
// подключение бота означало пересборку. Теперь бот подключается на /max
// живьём, поэтому ответ приходится спрашивать у базы: интерфейс должен
// узнать о боте в тот же день, а не после следующего развёртывания.
//
// Имя бота — не секрет (оно и так стоит в каждой ссылке-приглашении), а
// токен из этой таблицы браузеру не отдаётся вовсе: права на колонку с ним
// отозваны в миграции 0022.

// Переменная окружения, если она всё-таки задана, остаётся главнее — так же,
// как на сервере (см. botSettings.ts).
const FROM_ENV = process.env.NEXT_PUBLIC_MAX_BOT_USERNAME || "";

export function useMaxBot(): { username: string; available: boolean } {
  const [username, setUsername] = useState(FROM_ENV);

  useEffect(() => {
    if (FROM_ENV) return;
    let cancelled = false;
    void createClient()
      .from("bot_settings")
      .select("max_bot_username")
      .eq("id", true)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        // Ошибку глотаем молча: развёртывание может опережать базу, и это
        // означает «бота нет», а не «что-то сломалось».
        const name = (data as { max_bot_username?: string | null } | null)?.max_bot_username || "";
        if (name) setUsername(name);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { username, available: !!username };
}
