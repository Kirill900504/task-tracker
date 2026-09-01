-- Dedup log for Telegram reminders, so the periodic check (fired every few
-- minutes by an external pinger — Vercel's free cron only runs once a day)
-- sends each task/meeting reminder once, not on every run. No RLS policies
-- needed: RLS is enabled with none, so only the service_role (cron route)
-- can touch this table at all — the normal app never needs to.
create table public.telegram_notifications (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null,
  kind text not null, -- 'task_due' | 'meeting_soon' | 'meeting_now'
  ref_id text not null,
  notif_date date not null,
  created_at timestamptz not null default now(),
  unique (telegram_chat_id, kind, ref_id, notif_date)
);
alter table public.telegram_notifications enable row level security;
