"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { createSharedStore } from "@/lib/sharedStore";

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
//
// Ответ общий на всю вкладку (sharedStore): его спрашивают «Команда»,
// привязка мессенджера и подсказка о своём канале, и запрашивать одну и ту
// же строку по разу на каждое окно значит отложить открытие окна ради того,
// что уже известно. От этого же зависят кнопки «MAX» в «Команде»: пока
// ответа нет, их нет на экране, и появление их через полсекунды после
// открытия выглядит как дёрганый интерфейс.

// Переменная окружения, если она всё-таки задана, остаётся главнее — так же,
// как на сервере (см. botSettings.ts).
const FROM_ENV = process.env.NEXT_PUBLIC_MAX_BOT_USERNAME || "";

async function fetchMaxBot(): Promise<string | null> {
  const { data } = await createClient()
    .from("bot_settings")
    .select("max_bot_username")
    .eq("id", true)
    .maybeSingle();
  // Ошибку глотаем молча: развёртывание может опережать базу, и это
  // означает «бота нет», а не «что-то сломалось».
  return (data as { max_bot_username?: string | null } | null)?.max_bot_username || "";
}

const maxBot = createSharedStore<string>("", fetchMaxBot);

export function useMaxBot(): { username: string; available: boolean } {
  const { data: fromDb } = useSyncExternalStore(maxBot.subscribe, maxBot.snapshot, maxBot.serverSnapshot);

  useEffect(() => {
    if (FROM_ENV) return;
    maxBot.ensure();
  }, []);

  const username = FROM_ENV || fromDb;
  return { username, available: !!username };
}
