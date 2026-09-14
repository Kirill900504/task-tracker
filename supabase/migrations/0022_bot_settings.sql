-- Токен бота MAX живёт в базе, а не в переменной окружения.
--
-- Причина не техническая. Переменные окружения задаются в панели Vercel:
-- войти, найти проект, Settings → Environment Variables, добавить три
-- строки, нажать Redeploy. Это ровно тот путь через меню, который в этом
-- проекте запрещено предлагать: владелец — не технический человек, и
-- четыре экрана чужой панели ради трёх строк — это не «два клика».
--
-- Поэтому токен вводится в самом трекере, на своей странице (/max), а всё
-- остальное — секрет вебхука, подписка на обновления, имя бота — трекер
-- делает сам. Человеку остаётся одно действие: вставить токен, который ему
-- выдал MasterBot в MAX.
--
-- Таблица одна на установку, а не на пользователя: бот тоже один. Строка
-- ровно одна — это обеспечивает `id boolean primary key check (id)`.
--
-- Токен из базы читает только служебный клиент (он обходит RLS). Браузеру
-- он не виден вообще — не политикой, а правами на колонки: ниже отозваны
-- все права и выданы обратно только на неопасные колонки. Политика RLS
-- разрешает читать строку всем, кто вошёл: имя бота — не секрет, а
-- интерфейсу надо знать, показывать ли кнопки MAX.
--
-- Применяется так:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     supabase/migrations/0022_bot_settings.sql

create table if not exists public.bot_settings (
  id boolean primary key default true check (id),
  max_bot_token text,
  max_webhook_secret text,
  max_bot_username text,
  max_bot_name text,
  max_connected_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.bot_settings is
  'Настройки ботов на всю установку. Ровно одна строка (id = true).';
comment on column public.bot_settings.max_bot_token is
  'Токен бота MAX. Читается только service-role клиентом; для authenticated права на эту колонку отозваны.';

alter table public.bot_settings enable row level security;

-- Читать строку может любой вошедший — но только те колонки, на которые
-- ниже выданы права. Писать нельзя никому: запись идёт через
-- /api/max/setup служебным клиентом, который проверяет, что просит
-- владелец пространства.
drop policy if exists "bot_settings_select" on public.bot_settings;
create policy "bot_settings_select" on public.bot_settings for select to authenticated using (true);

-- Права на колонки — вторая, независимая от RLS граница. Даже если
-- политику выше однажды перепишут шире, токен всё равно не уедет в
-- браузер: PostgREST просто не сможет его выбрать.
revoke all on public.bot_settings from anon, authenticated;
grant select (id, max_bot_username, max_bot_name, max_connected_at, updated_at)
  on public.bot_settings to authenticated;
