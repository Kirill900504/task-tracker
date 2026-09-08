-- MAX (max.ru) as a second messenger alongside Telegram.
--
-- Deliberately mirrored on the Telegram tables rather than folded into them:
-- the same person can be connected to both, and one row per messenger keeps
-- "who is this chat" answerable without a compound key everywhere. What the
-- bot then DOES with a message is shared code (see src/lib/botPipeline.ts) —
-- only the storage and the transport differ.
--
-- MAX addresses a private conversation by the person's user_id, not by a
-- chat id (POST /messages?user_id=...), so that is what is stored.

create table if not exists public.max_accounts (
  max_user_id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Holds the original message while waiting for the answer to a single
  -- clarifying question, exactly as telegram_accounts does.
  pending_context text,
  pending_action jsonb
);
alter table public.max_accounts enable row level security;

drop policy if exists "max_accounts_select_own" on public.max_accounts;
create policy "max_accounts_select_own" on public.max_accounts for select using (user_id = auth.uid());
drop policy if exists "max_accounts_delete_own" on public.max_accounts;
create policy "max_accounts_delete_own" on public.max_accounts for delete using (user_id = auth.uid());

-- Same reasoning as telegram_processed_updates: a webhook that does not get
-- a fast 2xx is redelivered, and a repeated update must not produce a second
-- task. MAX updates carry no id of their own, so the key is composed from
-- the message id (or the callback id) by the route.
create table if not exists public.max_processed_updates (
  update_key text primary key,
  processed_at timestamptz not null default now()
);
alter table public.max_processed_updates enable row level security;
-- No policies: only the service-role client (the webhook) touches this.

-- A colleague can be connected to either messenger, or to both.
alter table public.assignees
  add column if not exists max_user_id bigint,
  add column if not exists max_username text,
  add column if not exists max_linked_at timestamptz;

create unique index if not exists assignees_owner_max_idx
  on public.assignees (user_id, max_user_id)
  where max_user_id is not null;

-- One code table serves both messengers; the channel says which bot the
-- code was issued for, so a Telegram code cannot link a MAX chat.
alter table public.telegram_link_codes
  add column if not exists channel text not null default 'telegram';

-- The AI action log records where a request came from; MAX is now a third
-- possible answer alongside Telegram and the web app.
alter table public.ai_action_logs drop constraint if exists ai_action_logs_source_check;
alter table public.ai_action_logs add constraint ai_action_logs_source_check
  check (source in ('telegram', 'web', 'max'));

-- Reminders are deduplicated per PERSON, not per Telegram chat: the same
-- morning brief must not arrive twice just because its owner is connected to
-- two messengers. Existing rows are backfilled so nothing already sent today
-- is sent again.
alter table public.telegram_notifications
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.telegram_notifications alter column telegram_chat_id drop not null;

update public.telegram_notifications n
  set user_id = a.user_id
  from public.telegram_accounts a
  where n.user_id is null and n.telegram_chat_id = a.telegram_chat_id;

create unique index if not exists telegram_notifications_user_key
  on public.telegram_notifications (user_id, kind, ref_id, notif_date)
  where user_id is not null;
