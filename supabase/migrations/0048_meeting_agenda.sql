-- Повестка встречи: пункты до встречи, итог по пунктам, пункт → задача.
--
-- 07.10.2026, п.3.1 предложений, «делай». Итог встречи — один текст, и
-- задачи из него заводят руками, то есть чаще не заводят: решили на
-- планёрке, а на доске пусто. Повестка — список пунктов в карточке
-- встречи: участники видят и дописывают его заранее, на встрече у пункта
-- пишется, что решили, и пункт одним нажатием открывает форму задачи с
-- этим текстом и итогом.
--
-- Своя таблица, а не колонка встречи: дописывают пункты ВСЕ участники, а
-- встречу правит только организатор, и синхронизация встреч («пишу только
-- своё») чужой пункт до базы не довезла бы. Права повторяют обсуждение
-- (0019, 0041): видят участники и организатор, пишет каждый из них свои
-- пункты; итог и задачу у любого пункта ставит организатор — на встрече
-- записывает он.

create table if not exists public.meeting_agenda (
  id uuid primary key default gen_random_uuid(),
  -- Пространство. Ставит триггер по встрече — как у item_comments, —
  -- поэтому default auth.uid() здесь только по правилу проекта.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meeting_id text not null references public.meetings(id) on delete cascade,
  text text not null check (length(btrim(text)) between 1 and 500),
  position integer not null default 0,
  -- Что решили по пункту. Пусто — ещё не обсуждали.
  note text not null default '',
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists meeting_agenda_meeting_idx on public.meeting_agenda (meeting_id, position);

create or replace function public.set_agenda_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_owner uuid;
begin
  select user_id into parent_owner from public.meetings where id = new.meeting_id;
  if parent_owner is null then
    raise exception 'agenda item references a meeting that does not exist';
  end if;
  new.user_id = parent_owner;
  return new;
end;
$$;

drop trigger if exists meeting_agenda_workspace on public.meeting_agenda;
create trigger meeting_agenda_workspace before insert on public.meeting_agenda
  for each row execute function public.set_agenda_workspace();

alter table public.meeting_agenda enable row level security;

-- Кто видит встречу изнутри: участник или организатор.
create or replace function public.can_see_meeting(p_owner uuid, p_meeting text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_owner = auth.uid()
      or (
        p_owner = public.workspace_of(auth.uid())
        and (public.is_participant(p_owner, 'meeting', p_meeting) or auth.uid() = public.meeting_author(p_meeting))
      )
$$;
revoke all on function public.can_see_meeting(uuid, text) from public;
grant execute on function public.can_see_meeting(uuid, text) to authenticated;

-- Организатор — тот, кто собрал встречу; у встреч владельца автор пуст.
create or replace function public.is_meeting_organizer(p_owner uuid, p_meeting text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = coalesce(public.meeting_author(p_meeting), p_owner)
$$;
revoke all on function public.is_meeting_organizer(uuid, text) from public;
grant execute on function public.is_meeting_organizer(uuid, text) to authenticated;

drop policy if exists "meeting_agenda_visible" on public.meeting_agenda;
create policy "meeting_agenda_visible" on public.meeting_agenda for select
  using (public.can_see_meeting(user_id, meeting_id));

-- Вставка: user_id ставит триггер ДО проверки, поэтому политика видит уже
-- настоящее пространство встречи.
drop policy if exists "meeting_agenda_add" on public.meeting_agenda;
create policy "meeting_agenda_add" on public.meeting_agenda for insert
  with check (author_id = auth.uid() and public.can_see_meeting(user_id, meeting_id));

drop policy if exists "meeting_agenda_edit" on public.meeting_agenda;
create policy "meeting_agenda_edit" on public.meeting_agenda for update
  using (public.can_see_meeting(user_id, meeting_id) and (author_id = auth.uid() or public.is_meeting_organizer(user_id, meeting_id)))
  with check (public.can_see_meeting(user_id, meeting_id));

drop policy if exists "meeting_agenda_remove" on public.meeting_agenda;
create policy "meeting_agenda_remove" on public.meeting_agenda for delete
  using (author_id = auth.uid() or public.is_meeting_organizer(user_id, meeting_id));

-- Повестку видно сразу у всех, кто открыл встречу.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'meeting_agenda') then
    alter publication supabase_realtime add table public.meeting_agenda;
  end if;
end $$;
