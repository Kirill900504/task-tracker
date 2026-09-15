-- Имя на карточке и строка участия — одно и то же, записанное дважды.
--
-- У задачи есть поле `assignee` — строка с именем, которую видно на карточке
-- и в мессенджере, — и есть строки в `task_participants`, в которых живут
-- «Принял / Сделал / Не могу», «2 из 4», напоминания и статистика по людям.
-- У встречи так же: массив имён `participants` рядом с `meeting_participants`.
--
-- Пока они сходятся, всё честно. Когда расходятся, трекер врёт в самую
-- дорогую сторону: постановщик видит имя и считает, что поручил, а человеку
-- не пришло ничего. Так и было — 15.09.2026 в боевой базе нашлись две
-- задачи с именем и без исполнителя и 26 встреч из 28 без единой строки
-- голосования. Причины были в коде: задачи создавались в трёх местах, и два
-- из них строк не заводили (см. assignExecutors.ts).
--
-- Код починен, но чинит он три известных места. Появится четвёртое — и всё
-- повторится, потому что ничто, кроме внимательности, не связывает имя со
-- строкой. Здесь эта связь становится свойством базы: имя, за которым стоит
-- известный человек, САМО заводит строку.
--
-- Три ограничения, каждое выстраданное:
--
--   * только когда строк нет вовсе И имя действительно изменилось. Одного
--     первого условия мало, и это проверено: движок синхронизации
--     переписывает строку задачи целиком при каждом сохранении, так что
--     `assignee` участвует в каждом UPDATE, даже когда не менялся, — и
--     снятый исполнитель воскресал от переименования задачи;
--   * себя не назначаем. «Кирилл (я)» — это не поручение, и в интерфейсе
--     оно тоже пропускается (isSelfAssignee);
--   * уведомление остаётся за приложением. Триггер может завести строку, но
--     не может написать человеку, а «назначил и не сказал» — это ровно то,
--     ради чего трекер и затевался. Поэтому assignExecutors.ts никуда не
--     девается: он делает и то, и другое, а это — страховка под ним.
--
-- Применяется так:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     supabase/migrations/0024_name_implies_a_row.sql

create or replace function public.task_assignee_implies_participant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  target uuid;
begin
  if coalesce(new.assignee, '') = '' or new.assignee ilike '%(я)%' then
    return new;
  end if;
  if exists (select 1 from public.task_participants p where p.task_id = new.id) then
    return new;
  end if;
  select a.id into target
    from public.assignees a
   where a.user_id = new.user_id and a.name = new.assignee
   limit 1;
  if target is null then
    return new;
  end if;
  insert into public.task_participants (task_id, assignee_id, role)
  values (new.id, target, 'executor')
  on conflict do nothing;
  return new;
end;
$$;

-- Два триггера, а не один: условие «имя изменилось» ссылается на OLD, а на
-- вставке OLD не существует. Разделение и есть то, что отличает «завели
-- задачу на человека» от «сохранили задачу, у которой это имя и было».
drop trigger if exists task_assignee_implies_participant on public.tasks;
drop trigger if exists task_assignee_implies_participant_ins on public.tasks;
drop trigger if exists task_assignee_implies_participant_upd on public.tasks;

create trigger task_assignee_implies_participant_ins
  after insert on public.tasks
  for each row
  execute function public.task_assignee_implies_participant();

create trigger task_assignee_implies_participant_upd
  after update of assignee on public.tasks
  for each row
  when (old.assignee is distinct from new.assignee)
  execute function public.task_assignee_implies_participant();

-- Встреча: то же самое для каждого имени из массива, у которого ещё нет
-- строки. Удалять триггер не имеет права никогда — состав встречи меняет
-- владелец, и снятого участника должен снимать он, а не побочный эффект.
create or replace function public.meeting_names_imply_participants()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.participants is null or array_length(new.participants, 1) is null then
    return new;
  end if;
  insert into public.meeting_participants (meeting_id, assignee_id, role, response, round)
  select new.id, a.id, 'participant', 'none', coalesce(new.vote_round, 1)
    from public.assignees a
   where a.user_id = new.user_id
     and a.name = any (new.participants)
     and a.name not ilike '%(я)%'
     and not exists (
       select 1 from public.meeting_participants p
        where p.meeting_id = new.id and p.assignee_id = a.id
     )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists meeting_names_imply_participants on public.meetings;
drop trigger if exists meeting_names_imply_participants_ins on public.meetings;
drop trigger if exists meeting_names_imply_participants_upd on public.meetings;

create trigger meeting_names_imply_participants_ins
  after insert on public.meetings
  for each row
  execute function public.meeting_names_imply_participants();

create trigger meeting_names_imply_participants_upd
  after update of participants on public.meetings
  for each row
  when (old.participants is distinct from new.participants)
  execute function public.meeting_names_imply_participants();
