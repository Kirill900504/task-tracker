-- История переносов срока на самой задаче (14.10.2026).
--
-- Предложение 5 из разбора 13.10.2026, одобренное Кириллом: «история сроков
-- на кубике (ClickUp, baseline): „срок сдвигали 3 раза, изначально 01.10“».
-- Задача, срок которой двигали трижды, выглядит на доске так же, как
-- поставленная вчера, — а это и есть вопрос, который постановщик задаёт
-- первым: «сколько раз мы это уже откладывали?».
--
-- Считает ТРИГГЕР, а не код: срок двигают пять дверей (форма своей задачи,
-- согласие на просьбу о переносе, «Продлить» в боте, перенос из мессенджера,
-- синхронизация), и счётчик в коде одной из них разошёлся бы с остальными
-- (то же правило, что у номера задачи, миграция 0045).
--
--   first_deadline — самый первый срок задачи; ставится, когда срок
--                    появляется впервые, и больше не меняется;
--   deadline_moves — сколько раз срок меняли с одной даты на другую.
--                    Появление срока у задачи без срока переносом не
--                    считается — это назначение, а не перенос.
--
-- Синхронизация пишет задачи upsert'ом, и у существующей строки он кончается
-- UPDATE — BEFORE UPDATE видит и его. Колонок этих нет в taskToRow, поэтому
-- запись из браузера их не затирает.

alter table public.tasks add column if not exists first_deadline date;
alter table public.tasks add column if not exists deadline_moves integer not null default 0;

-- У существующих задач первый срок неизвестен — берётся нынешний, и счёт
-- начинается с нуля: выдумывать прошлое незачем. До триггера: он сам
-- держит first_deadline неизменным на UPDATE и отменил бы эту строку.
drop trigger if exists tasks_deadline_history on public.tasks;
update public.tasks set first_deadline = deadline where first_deadline is null and deadline is not null;

create or replace function public.track_deadline_history() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.first_deadline := coalesce(new.first_deadline, new.deadline);
    new.deadline_moves := coalesce(new.deadline_moves, 0);
    return new;
  end if;
  -- Колонки истории пишет только этот триггер: что бы ни прислали в UPDATE,
  -- берётся прежнее значение.
  new.first_deadline := old.first_deadline;
  new.deadline_moves := old.deadline_moves;
  if new.deadline is distinct from old.deadline then
    if old.deadline is not null and new.deadline is not null then
      new.deadline_moves := old.deadline_moves + 1;
    end if;
    if new.first_deadline is null then
      new.first_deadline := coalesce(old.deadline, new.deadline);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_deadline_history on public.tasks;
create trigger tasks_deadline_history
  before insert or update on public.tasks
  for each row execute function public.track_deadline_history();

