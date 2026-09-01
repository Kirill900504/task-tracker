-- Task tracker: initial schema
-- Tables mirror the data model from the original prototype (tasks, meetings, ideas, assignees),
-- each row tagged with user_id so Row Level Security can keep every account's data private.

create extension if not exists "pgcrypto";

-- ---------- tasks ----------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  assignee text not null default '',
  priority text not null default 'med' check (priority in ('high','med')),
  term text not null default 'short' check (term in ('short','long')),
  status text not null default 'in_progress' check (status in ('in_progress','done')),
  deadline date,
  recur text not null default 'none' check (recur in ('none','daily','weekly','monthly','yearly')),
  recur_weekday int,
  recur_monthday int,
  recur_year_day int,
  recur_year_month int,
  last_completed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- meetings ----------
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  time text not null,
  title text not null,
  participants text[] not null default '{}',
  status text not null default 'planned' check (status in ('planned','success','no_result')),
  result text not null default '',
  moved_to_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- ideas ----------
create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null,
  important boolean not null default false,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- assignees ----------
create table public.assignees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------- keep updated_at fresh ----------
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

create trigger meetings_set_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();

-- ---------- Row Level Security: every user sees only their own rows ----------
alter table public.tasks enable row level security;
alter table public.meetings enable row level security;
alter table public.ideas enable row level security;
alter table public.assignees enable row level security;

create policy "tasks_select_own" on public.tasks for select using (user_id = auth.uid());
create policy "tasks_insert_own" on public.tasks for insert with check (user_id = auth.uid());
create policy "tasks_update_own" on public.tasks for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "tasks_delete_own" on public.tasks for delete using (user_id = auth.uid());

create policy "meetings_select_own" on public.meetings for select using (user_id = auth.uid());
create policy "meetings_insert_own" on public.meetings for insert with check (user_id = auth.uid());
create policy "meetings_update_own" on public.meetings for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "meetings_delete_own" on public.meetings for delete using (user_id = auth.uid());

create policy "ideas_select_own" on public.ideas for select using (user_id = auth.uid());
create policy "ideas_insert_own" on public.ideas for insert with check (user_id = auth.uid());
create policy "ideas_update_own" on public.ideas for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ideas_delete_own" on public.ideas for delete using (user_id = auth.uid());

create policy "assignees_select_own" on public.assignees for select using (user_id = auth.uid());
create policy "assignees_insert_own" on public.assignees for insert with check (user_id = auth.uid());
create policy "assignees_update_own" on public.assignees for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "assignees_delete_own" on public.assignees for delete using (user_id = auth.uid());
