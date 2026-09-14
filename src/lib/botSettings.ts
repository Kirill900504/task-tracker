import { createAdminClient } from "@/lib/supabase/admin";

// Где лежит токен бота MAX и почему его читают отсюда, а не из process.env.
//
// Telegram настроен переменными окружения, и это нормально: их задали один
// раз, при первом развёртывании, руками разработчика. Для MAX так не
// вышло — токен появился позже, а задать переменную в Vercel может только
// владелец, и это четыре экрана чужой панели. Поэтому токен вводится в
// самом трекере и хранится в таблице bot_settings (миграция 0022).
//
// Переменная окружения по-прежнему главнее базы: так локальный запуск и
// тесты остаются полностью управляемыми через .env.local, а установка, где
// токен всё-таки задан «по-взрослому», не начнёт вдруг читать базу.
//
// Читается это на каждое отправленное сообщение, поэтому ответ живёт в
// памяти процесса минуту. Минута — не догма: столько держится «бот только
// что подключён, а функция ещё об этом не знает», и ровно поэтому
// /api/max/setup сбрасывает кэш явно.

export type MaxSettings = {
  token: string;
  // Секрет вебхука. Пустой — только у установки, где токен задан
  // переменной окружения, а секрет забыли: сам вебхук тогда отвергнет
  // всё, что придёт, и это видно сразу.
  secret: string;
  username: string;
  name: string;
};

const TTL_MS = 60_000;

let cache: { at: number; value: MaxSettings | null } | null = null;

function fromEnv(): MaxSettings | null {
  const token = (process.env.MAX_BOT_TOKEN || "").trim();
  if (!token) return null;
  return {
    token,
    secret: process.env.MAX_WEBHOOK_SECRET || "",
    username: process.env.MAX_BOT_USERNAME || process.env.NEXT_PUBLIC_MAX_BOT_USERNAME || "",
    name: "",
  };
}

export async function maxSettings(): Promise<MaxSettings | null> {
  const env = fromEnv();
  if (env) return env;

  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  let value: MaxSettings | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("bot_settings")
      .select("max_bot_token, max_webhook_secret, max_bot_username, max_bot_name")
      .eq("id", true)
      .maybeSingle();
    const row = data as Record<string, string | null> | null;
    if (row?.max_bot_token) {
      value = {
        token: row.max_bot_token,
        secret: row.max_webhook_secret || "",
        username: row.max_bot_username || "",
        name: row.max_bot_name || "",
      };
    }
  } catch {
    // Развёртывание может опережать базу: таблицы ещё нет, ключей ещё нет.
    // Это означает «MAX не подключён», а не «всё сломалось» — ни одна
    // отправка в Telegram от этого падать не должна.
    value = null;
  }

  cache = { at: Date.now(), value };
  return value;
}

export function forgetMaxSettings(): void {
  cache = null;
}
