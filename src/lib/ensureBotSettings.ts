// Таблица настроек бота заводится сама, при первом обращении.
//
// Обычно миграцию применяют отдельно: либо скриптом из терминала, либо
// вставкой в SQL-редактор Supabase. Оба пути упираются в одно и то же — их
// выполняет человек, для которого и терминал, и чужая панель это лишний
// экран, а страница /max ради одной вставки токена превращается в две
// разные процедуры в разных местах.
//
// Поэтому ровно одна миграция — эта — умеет применить себя сама. Здесь нет
// и не должно появиться выполнения произвольного SQL: текст ниже
// фиксированный, идемпотентный (`if not exists`, `drop policy if exists`) и
// в точности повторяет supabase/migrations/0022_bot_settings.sql — это
// проверяется тестом, чтобы две копии не разошлись.
//
// Запускается только по дороге к настройкам бота и только тогда, когда
// таблицы действительно нет.

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Тот же текст, что и в файле миграции. Файл читается, когда он есть рядом
// (локальный запуск, тесты), иначе берётся встроенная копия: на Vercel
// каталог supabase в сборку не попадает.
export const BOT_SETTINGS_SQL = `
create table if not exists public.bot_settings (
  id boolean primary key default true check (id),
  max_bot_token text,
  max_webhook_secret text,
  max_bot_username text,
  max_bot_name text,
  max_connected_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.bot_settings enable row level security;

drop policy if exists "bot_settings_select" on public.bot_settings;
create policy "bot_settings_select" on public.bot_settings for select to authenticated using (true);

revoke all on public.bot_settings from anon, authenticated;
grant select (id, max_bot_username, max_bot_name, max_connected_at, updated_at)
  on public.bot_settings to authenticated;
`;

export function migrationFileSql(): string | null {
  try {
    return readFileSync(join(process.cwd(), "supabase/migrations/0022_bot_settings.sql"), "utf8");
  } catch {
    return null;
  }
}

export type EnsureResult = { ok: true } | { ok: false; error: string };

// Прямое подключение к Postgres, а не через PostgREST: создать таблицу
// service-role ключом нельзя — он умеет только читать и писать строки.
export async function ensureBotSettingsTable(): Promise<EnsureResult> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return {
      ok: false,
      error:
        "В окружении нет DATABASE_URL, поэтому таблицу настроек не создать автоматически — примените миграцию 0022_bot_settings.sql в SQL-редакторе Supabase.",
    };
  }
  try {
    const { default: pg } = await import("pg");
    // Пул Supabase требует SSL; без него ошибка приходит как «неверный
    // пароль», что уводит поиск совсем не туда.
    const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      await client.query(migrationFileSql() ?? BOT_SETTINGS_SQL);
    } finally {
      await client.end();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// «Таблицы нет» глазами PostgREST: код Postgres 42P01 приходит не всегда,
// в свежих версиях это собственный код PGRST205 и текст про отсутствующую
// таблицу в кэше схемы.
export function looksLikeMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204") return true;
  return /schema cache|does not exist/i.test(error.message || "");
}
