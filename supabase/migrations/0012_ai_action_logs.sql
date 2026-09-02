-- AI action log (spec-audit recommendation #2): every GigaChat quick-add
-- call, success or failure, so debugging a "the bot misunderstood me"
-- report no longer depends on the user screenshotting Telegram — it's a
-- query away.
create table public.ai_action_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source text not null check (source in ('telegram','web')),
  input_text text not null,
  success boolean not null,
  result_summary text,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.ai_action_logs enable row level security;
create policy "ai_action_logs_select_own" on public.ai_action_logs for select using (user_id = auth.uid());
create policy "ai_action_logs_insert_own" on public.ai_action_logs for insert with check (user_id = auth.uid());
