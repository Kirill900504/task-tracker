-- Telegram integration: linking codes (short-lived handshake) and the
-- permanent chat_id -> user_id mapping. Both tables are only ever written by
-- the server (app for codes, webhook for accounts) — RLS still applies for
-- normal (anon-key) access; the webhook uses the service_role key, which
-- bypasses RLS by design, and always sets user_id explicitly itself.

create table public.telegram_link_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);
alter table public.telegram_link_codes enable row level security;

create policy "telegram_link_codes_select_own" on public.telegram_link_codes for select using (user_id = auth.uid());
create policy "telegram_link_codes_insert_own" on public.telegram_link_codes for insert with check (user_id = auth.uid());
create policy "telegram_link_codes_delete_own" on public.telegram_link_codes for delete using (user_id = auth.uid());

create table public.telegram_accounts (
  telegram_chat_id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- holds the original message text while we're waiting on the user's
  -- answer to a single clarifying question (see /api/telegram/webhook)
  pending_context text
);
alter table public.telegram_accounts enable row level security;

create policy "telegram_accounts_select_own" on public.telegram_accounts for select using (user_id = auth.uid());
create policy "telegram_accounts_delete_own" on public.telegram_accounts for delete using (user_id = auth.uid());
