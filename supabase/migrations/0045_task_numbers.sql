-- Номер у задачи: «#42».
--
-- 07.10.2026, п.5 предложений, «согласен». Задачу называют по телефону и
-- в переписке, и «та, про смету, которую Игорю на прошлой неделе» — это
-- три вопроса вместо одного. Номер короткий, свой у каждого пространства
-- (у четырнадцати людей одно пространство, значит и счёт один на всех) и
-- не меняется никогда: ни после закрытия, ни после удаления — иначе «#42»
-- из вчерашней переписки сегодня означал бы другую задачу.
--
-- Номер ставит база, а не браузер: два человека, заводящие задачу в одну
-- секунду, иначе получили бы одинаковый. Счётчик — строка на пространство
-- в своей таблице, и её блокировка выстраивает одновременные вставки в
-- очередь. max(number)+1 по задачам для этого не годится: два чтения в
-- одну секунду видят один и тот же максимум.
--
-- Политик у счётчика нет НАМЕРЕННО: его трогает только триггер (security
-- definer). Браузеру он не нужен.

alter table public.tasks add column if not exists number integer;

create table if not exists public.task_counters (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  last integer not null default 0
);

alter table public.task_counters enable row level security;

-- Прежние задачи нумеруются в порядке заведения.
with numbered as (
  select id, row_number() over (partition by user_id order by created_at, id) as n
  from public.tasks
  where user_id is not null
)
update public.tasks t set number = numbered.n
from numbered
where t.id = numbered.id and t.number is null;

insert into public.task_counters (user_id, last)
select user_id, max(number) from public.tasks where user_id is not null and number is not null group by user_id
on conflict (user_id) do update set last = greatest(public.task_counters.last, excluded.last);

create or replace function public.assign_task_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.number is not null or new.user_id is null then
    return new;
  end if;
  -- Синхронизация пишет задачи upsert'ом, а BEFORE INSERT срабатывает и у
  -- того upsert'а, который кончится обновлением. Без этой проверки каждая
  -- правка срока сжигала бы номер, и счёт шёл бы с дырами в десятки.
  if exists (select 1 from public.tasks where id = new.id) then
    return new;
  end if;
  insert into public.task_counters (user_id, last) values (new.user_id, 1)
  on conflict (user_id) do update set last = public.task_counters.last + 1
  returning last into new.number;
  return new;
end;
$$;

drop trigger if exists tasks_assign_number on public.tasks;
create trigger tasks_assign_number
  before insert on public.tasks
  for each row execute function public.assign_task_number();

create unique index if not exists tasks_space_number_idx
  on public.tasks (user_id, number)
  where number is not null;
