-- Чек-лист внутри задачи (14.10.2026).
--
-- Предложение 1 из разбора 13.10.2026, одобренное Кириллом: «чек-лист
-- внутри задачи (Kaiten, YouGile) — шаги с галочками, которые видят все на
-- задаче; „сделали 3 из 5 шагов“ — ход работы без единого сообщения».
--
-- Своя таблица, а не колонка задачи — по той же причине, что повестка
-- встречи (0048): отмечают шаги ИСПОЛНИТЕЛИ, а строку задачи правит только
-- постановщик, и синхронизация задач («пишу только своё») чужую галочку до
-- базы не довезла бы.
--
-- Права:
--   видят      — все, кто видит задачу (постановщик и все на ней);
--   добавляют,
--   отмечают   — постановщик, исполнители и соисполнители (наблюдатель
--                только смотрит — так он и назван);
--   убирают    — автор шага или постановщик;
--   у закрытой задачи — ничего, кроме чтения (правило 0056).

create table if not exists public.task_checklist (
  id uuid primary key default gen_random_uuid(),
  -- Пространство ставит триггер по задаче (как у повестки), default —
  -- только по правилу проекта.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id text not null references public.tasks(id) on delete cascade,
  text text not null check (length(btrim(text)) between 1 and 500),
  position integer not null default 0,
  done boolean not null default false,
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists task_checklist_task_idx on public.task_checklist (task_id, position);

create or replace function public.set_checklist_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_owner uuid;
begin
  select user_id into parent_owner from public.tasks where id = new.task_id;
  if parent_owner is null then
    raise exception 'checklist item references a task that does not exist';
  end if;
  new.user_id = parent_owner;
  return new;
end;
$$;

drop trigger if exists task_checklist_workspace on public.task_checklist;
create trigger task_checklist_workspace before insert on public.task_checklist
  for each row execute function public.set_checklist_workspace();

alter table public.task_checklist enable row level security;

-- Моя строка в списке людей этого пространства — и у владельца тоже: у
-- него нет строки членства, его строка помечена «(я)». my_assignee() в базе
-- на 14.10.2026 этой ветки не знает (её добавляет 0057), поэтому здесь
-- она своя — иначе владелец, исполнитель задачи руководителя, не видел бы
-- её чек-лист.
create or replace function public.my_row_in(p_owner uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.my_assignee(p_owner),
    (select id from public.assignees
      where p_owner = auth.uid() and user_id = p_owner and rtrim(name) like '%(я)'
      order by created_at limit 1)
  )
$$;
revoke all on function public.my_row_in(uuid) from public;
grant execute on function public.my_row_in(uuid) to authenticated;

-- Видит задачу: постановщик или любой на ней (то же правило, что у самой
-- задачи — tasks_visible).
create or replace function public.can_see_task(p_owner uuid, p_task text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (p_owner = auth.uid() or p_owner = public.workspace_of(auth.uid()))
     and (
       auth.uid() = coalesce(public.task_author(p_task), p_owner)
       or exists (select 1 from public.task_participants tp where tp.task_id = p_task and tp.assignee_id = public.my_row_in(p_owner))
     )
$$;
revoke all on function public.can_see_task(uuid, text) from public;
grant execute on function public.can_see_task(uuid, text) to authenticated;

-- Работает над задачей: постановщик, исполнитель или соисполнитель.
create or replace function public.works_on_task(p_owner uuid, p_task text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (p_owner = auth.uid() or p_owner = public.workspace_of(auth.uid()))
     and (
       auth.uid() = coalesce(public.task_author(p_task), p_owner)
       or exists (
         select 1 from public.task_participants tp
          where tp.task_id = p_task
            and tp.assignee_id = public.my_row_in(p_owner)
            and tp.role in ('executor', 'coexecutor')
       )
     )
$$;
revoke all on function public.works_on_task(uuid, text) from public;
grant execute on function public.works_on_task(uuid, text) to authenticated;

drop policy if exists "task_checklist_visible" on public.task_checklist;
create policy "task_checklist_visible" on public.task_checklist for select
  using (public.can_see_task(user_id, task_id));

-- Вставка: user_id ставит триггер ДО проверки.
drop policy if exists "task_checklist_add" on public.task_checklist;
create policy "task_checklist_add" on public.task_checklist for insert
  with check (
    author_id = auth.uid()
    and public.works_on_task(user_id, task_id)
    and not public.item_closed('task', task_id)
  );

drop policy if exists "task_checklist_edit" on public.task_checklist;
create policy "task_checklist_edit" on public.task_checklist for update
  using (public.works_on_task(user_id, task_id) and not public.item_closed('task', task_id))
  with check (public.works_on_task(user_id, task_id));

drop policy if exists "task_checklist_remove" on public.task_checklist;
create policy "task_checklist_remove" on public.task_checklist for delete
  using (
    (author_id = auth.uid() or auth.uid() = coalesce(public.task_author(task_id), user_id))
    and not public.item_closed('task', task_id)
  );

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'task_checklist') then
    alter publication supabase_realtime add table public.task_checklist;
  end if;
end $$;
