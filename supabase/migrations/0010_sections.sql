-- Sections ("разделы") group tasks by area of work — Кирилл's own
-- read of "projects" from the spec-audit recommendations: a flat,
-- user-managed list (not a separate hierarchical entity), distinguishing
-- "work" from "personal" for visual treatment.
create table public.sections (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'work' check (kind in ('work','personal')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.sections enable row level security;
create policy "sections_select_own" on public.sections for select using (user_id = auth.uid());
create policy "sections_insert_own" on public.sections for insert with check (user_id = auth.uid());
create policy "sections_update_own" on public.sections for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "sections_delete_own" on public.sections for delete using (user_id = auth.uid());

alter table public.tasks add column section_id text references public.sections(id) on delete set null;

alter publication supabase_realtime add table public.sections;

-- Default sections for the one existing user, per his own list.
insert into public.sections (id, user_id, name, kind, sort_order) values
  ('sec_general',   'c2510984-5ff9-44bf-8d40-a155d4102ac1', 'Общие',      'work',     0),
  ('sec_retail',    'c2510984-5ff9-44bf-8d40-a155d4102ac1', 'Розница',    'work',     1),
  ('sec_dev',       'c2510984-5ff9-44bf-8d40-a155d4102ac1', 'Разработка', 'work',     2),
  ('sec_wholesale', 'c2510984-5ff9-44bf-8d40-a155d4102ac1', 'ОПТ',        'work',     3),
  ('sec_service',   'c2510984-5ff9-44bf-8d40-a155d4102ac1', 'Сервис',     'work',     4),
  ('sec_iiko',      'c2510984-5ff9-44bf-8d40-a155d4102ac1', 'iiko',       'work',     5),
  ('sec_marketing', 'c2510984-5ff9-44bf-8d40-a155d4102ac1', 'Маркетинг',  'work',     6),
  ('sec_site',      'c2510984-5ff9-44bf-8d40-a155d4102ac1', 'Сайт',       'work',     7),
  ('sec_personal',  'c2510984-5ff9-44bf-8d40-a155d4102ac1', 'Личные',     'personal', 8);
