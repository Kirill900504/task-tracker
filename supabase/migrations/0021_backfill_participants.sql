-- Перенести то, что уже есть, в новый вид.
--
-- Задачи и встречи, заведённые до всего этого, адресованы именем: в задаче
-- строка `assignee`, во встрече массив `participants`. Новый механизм —
-- «2 из 4», отчёты, голосование, экран руководителя — работает по строкам
-- участия, которых у старых записей нет.
--
-- Без этого переноса первый же руководитель, который войдёт в трекер,
-- увидит пустой экран: за ним числятся четыре задачи, и ни одной строки
-- участия. Он решит, что трекер не работает, и будет прав.
--
-- Переносится только живое. Закрытые задачи и прошедшие встречи трогать
-- незачем: отчитываться по ним поздно, а история и так осталась в самих
-- записях. Повторный запуск ничего не испортит — `on conflict do nothing`.

-- ------------------------------------------------------------- задачи

insert into public.task_participants (user_id, task_id, assignee_id, role, accepted_at)
select t.user_id, t.id, a.id, 'executor', t.accepted_at
from public.tasks t
join public.assignees a
  on a.user_id = t.user_id
 and a.name = t.assignee
where t.deleted_at is null
  and t.status <> 'done'
  and coalesce(t.assignee, '') <> ''
on conflict (task_id, assignee_id) do nothing;

-- ------------------------------------------------------------ встречи

-- Ответ «буду», уже нажатый в Telegram, переносится вместе с человеком:
-- заставить подтверждать заново тех, кто подтвердил вчера, — верный способ
-- показать, что трекеру нельзя доверять.
insert into public.meeting_participants (user_id, meeting_id, assignee_id, role, response, responded_at, round)
select
  m.user_id,
  m.id,
  a.id,
  'participant',
  case when a.name = any(coalesce(m.confirmed_by, '{}')) then 'yes' else 'none' end,
  case when a.name = any(coalesce(m.confirmed_by, '{}')) then now() else null end,
  coalesce(m.vote_round, 1)
from public.meetings m
join public.assignees a
  on a.user_id = m.user_id
 and a.name = any(m.participants)
where m.deleted_at is null
  and m.status = 'planned'
  and m.date >= current_date
on conflict (meeting_id, assignee_id) do nothing;
