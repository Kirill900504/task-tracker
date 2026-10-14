-- Опрос времени встречи (14.10.2026).
--
-- Предложение 9 из разбора 13.10.2026, одобренное Кириллом: «опрос по
-- времени встречи (Doodle, Calendly): организатор предлагает два-три слота,
-- участники отмечают удобные, встреча назначается на лучший сама».
--
-- Встреча-опрос — это предложенная встреча (status 'proposed', 0034) с
-- вариантами времени. Отдельного состояния нет: предложение и так значит
-- «время ещё не занято, ждём ответов», и календарь с напоминаниями его уже
-- не видят. Когда отметили все — сервер ставит вариант, подходящий
-- большинству (при равенстве — более ранний), и встреча становится
-- назначенной (lib/meetingPoll).
--
--   meetings.slot_options — [{date, time}], первый — тот, что выбран в
--                           форме. Пишет организатор через синхронизацию;
--                           пустой массив — не опрос.
--   meeting_slot_votes    — какие варианты подходят человеку (номера в
--                           slot_options). Строка на человека; пустой
--                           список — «не подходит ничего», это тоже ответ.
--
-- Голос пишет маршрут /api/workspace/slot-vote и бот (служебным ключом), а
-- не браузер: после каждого голоса надо проверить, не пора ли назначать, и
-- делать это в двух местах значило бы разойтись (правило «ответ идёт через
-- маршрут»). Браузер голоса только читает.

alter table public.meetings add column if not exists slot_options jsonb not null default '[]'::jsonb;

create table if not exists public.meeting_slot_votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meeting_id text not null references public.meetings(id) on delete cascade,
  assignee_id uuid not null references public.assignees(id) on delete cascade,
  slots integer[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (meeting_id, assignee_id)
);

create or replace function public.set_slot_vote_workspace()
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
    raise exception 'slot vote references a meeting that does not exist';
  end if;
  new.user_id = parent_owner;
  return new;
end;
$$;

drop trigger if exists meeting_slot_votes_workspace on public.meeting_slot_votes;
create trigger meeting_slot_votes_workspace before insert on public.meeting_slot_votes
  for each row execute function public.set_slot_vote_workspace();

alter table public.meeting_slot_votes enable row level security;

-- Читают все, кто видит встречу (0048). Писать браузеру нечего — пишет
-- маршрут служебным ключом.
drop policy if exists "meeting_slot_votes_visible" on public.meeting_slot_votes;
create policy "meeting_slot_votes_visible" on public.meeting_slot_votes for select
  using (public.can_see_meeting(user_id, meeting_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'meeting_slot_votes') then
    alter publication supabase_realtime add table public.meeting_slot_votes;
  end if;
end $$;
