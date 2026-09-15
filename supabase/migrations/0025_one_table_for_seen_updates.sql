-- Одна таблица «это обновление уже обработали» вместо двух.
--
-- Мессенджер, не получивший ответ вовремя, присылает обновление снова. Если
-- не помнить, что оно уже обработано, второй заход заведёт вторую задачу —
-- поэтому у каждого канала была своя табличка-память. Разница между ними
-- была только в названии колонки: `update_id` у Telegram (число, которое
-- даёт он сам) и `update_key` у MAX (строка, которую приходится собирать из
-- id сообщения или нажатия, потому что своего номера у обновления там нет).
--
-- Два имени для одного и того же — и два места, где однажды поправят одно,
-- а второе забудут. Здесь остаётся одно: канал плюс ключ, ключ всегда
-- строка. Число Telegram прекрасно ею становится, и старые записи
-- переезжают как есть.
--
-- Потерять эту память не страшно: она отвечает на вопрос «не пришло ли это
-- дважды за последние минуты». Пустая таблица означает только, что первая
-- повторная доставка в ближайшие секунды после переезда не будет поймана —
-- поэтому строки всё-таки переносятся, а не бросаются.
--
-- Применяется так:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     supabase/migrations/0025_one_table_for_seen_updates.sql

create table if not exists public.bot_processed_updates (
  channel text not null check (channel in ('telegram', 'max')),
  update_key text not null,
  processed_at timestamptz not null default now(),
  primary key (channel, update_key)
);

comment on table public.bot_processed_updates is
  'Обработанные обновления мессенджеров. Защита от повторной доставки: повтор не должен заводить вторую задачу.';

-- Служебная таблица: браузеру здесь делать нечего вовсе, как и в двух
-- прежних. RLS включён без единой политики — это и есть «никому».
alter table public.bot_processed_updates enable row level security;
revoke all on public.bot_processed_updates from anon, authenticated;

insert into public.bot_processed_updates (channel, update_key, processed_at)
select 'telegram', update_id::text, processed_at from public.telegram_processed_updates
on conflict do nothing;

insert into public.bot_processed_updates (channel, update_key, processed_at)
select 'max', update_key, processed_at from public.max_processed_updates
on conflict do nothing;

drop table if exists public.telegram_processed_updates;
drop table if exists public.max_processed_updates;
