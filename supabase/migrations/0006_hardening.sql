-- Addresses two gaps flagged in review:
-- 1) /api/quick-add (and the Telegram equivalent) had no rate limiting.
-- 2) A failed cloud sync only ever showed a toast in the tab that hit it —
--    nothing durable to check after the fact.

create table public.api_rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  route text not null,
  created_at timestamptz not null default now()
);
create index api_rate_limits_lookup on public.api_rate_limits (user_id, route, created_at);
alter table public.api_rate_limits enable row level security;
create policy "api_rate_limits_select_own" on public.api_rate_limits for select using (user_id = auth.uid());
create policy "api_rate_limits_insert_own" on public.api_rate_limits for insert with check (user_id = auth.uid());

create table public.sync_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  acknowledged boolean not null default false
);
alter table public.sync_errors enable row level security;
create policy "sync_errors_select_own" on public.sync_errors for select using (user_id = auth.uid());
create policy "sync_errors_insert_own" on public.sync_errors for insert with check (user_id = auth.uid());
create policy "sync_errors_update_own" on public.sync_errors for update using (user_id = auth.uid()) with check (user_id = auth.uid());
