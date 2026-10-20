-- Напоминание себе из мессенджера: «напомни завтра в 9 про смету».
--
-- 20.10.2026, пятый из десяти пунктов, которые Кирилл одобрил одним словом
-- «давай». Напоминание — не задача: у него нет исполнителя, срока и
-- приёмки, и заводить ради «позвонить в банк в 15:00» карточку на доске
-- значило бы засорять доску тем, что через час уже неважно. Поэтому своя
-- маленькая таблица: кому (чат и мессенджер, куда просили), когда и что.
-- Крон напоминаний ходит раз в пять минут и шлёт то, чему пора.
--
-- Политик нет НАМЕРЕННО — как у bot_dialog и bot_messages: пишет бот и
-- читает крон, оба служебным ключом. Браузеру это не нужно.

create table if not exists public.bot_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Чьё напоминание: auth-id того, кто просил (ключ, а не связь).
  actor text not null,
  channel text not null check (channel in ('telegram', 'max')),
  chat_id bigint not null,
  due_at timestamptz not null,
  body text not null check (length(btrim(body)) between 1 and 500),
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.bot_reminders enable row level security;

create index if not exists bot_reminders_due_idx
  on public.bot_reminders (due_at)
  where sent_at is null and cancelled_at is null;
