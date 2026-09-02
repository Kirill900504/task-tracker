-- One row per user for small pieces of client-side state worth syncing
-- across devices/tabs — starting with the dashboard panel layout (which
-- zone each panel sits in and in what order), set by dragging panels
-- around ("constructor" mode). Kept as a single jsonb blob rather than a
-- normalized table: this is UI arrangement, not domain data, and the
-- shape is expected to evolve as more of the page becomes rearrangeable.
create table public.user_prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  panel_layout jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_prefs enable row level security;
create policy "user_prefs_select_own" on public.user_prefs for select using (user_id = auth.uid());
create policy "user_prefs_insert_own" on public.user_prefs for insert with check (user_id = auth.uid());
create policy "user_prefs_update_own" on public.user_prefs for update using (user_id = auth.uid()) with check (user_id = auth.uid());

alter publication supabase_realtime add table public.user_prefs;
