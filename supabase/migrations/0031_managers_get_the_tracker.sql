-- Руководитель получает трекер, а не экран с четырьмя кнопками.
--
-- Слова Кирилла: «хочу, чтобы у моих коллег был такой же интерфейс работы с
-- таск-трекером, как и у меня со всеми возможностями, НО ФУНКЦИЯ
-- АДМИНИСТРАТОРА БЫЛА ТОЛЬКО У МЕНЯ — у них ограниченные права на
-- структурные изменения трекера и удаления разделов и других элементов
-- системы».
--
-- Большая часть этого уже разрешена миграцией 0019: руководитель заводит
-- задачи, встречи и мысли в пространстве владельца, видит только своё и
-- правит только своё. Не хватало ровно двух вещей, и обе здесь.
--
-- 1. РАЗДЕЛЫ ОН НЕ ВИДЕЛ ВОВСЕ. Политика была `user_id = auth.uid()`, то
--    есть о чужих разделах он не знал ничего — и задача, заведённая им,
--    уезжала без раздела в трекер, где разделами пользуются. Здесь и
--    проходит граница, которую просит Кирилл: читать — всем в пространстве,
--    менять — только владельцу. Именно политикой, а не спрятанной кнопкой:
--    запрет, который обходится через консоль браузера, не запрет.
--
-- 2. УЧАСТНИКОВ В СВОЮ ЗАДАЧУ ОН НЕ МОГ ВПИСАТЬ. Писать в task_participants
--    разрешено владельцу пространства, и это правильно — иначе любой мог бы
--    вписать себя в чужую задачу. Но задача без исполнителя здесь не
--    заводится вовсе, то есть руководитель не мог завести ни одной. Право
--    даётся ровно на СВОИ задачи: `tasks.created_by = auth.uid()`.
--    Уведомить человека политика всё равно не может, поэтому назначение
--    идёт через /api/workspace/assign — он и строку заведёт, и скажет.
--    Политика тут сеть под маршрутом, как триггер 0024 под assignExecutors.
--
-- То же самое для участников встреч и получателей мыслей: завести встречу,
-- не позвав никого, — это не встреча.
--
-- Применяется так:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     supabase/migrations/0031_managers_get_the_tracker.sql

-- ------------------------------------------------------------- разделы

drop policy if exists "sections_select_own" on public.sections;
create policy "sections_visible" on public.sections for select
  using (user_id = auth.uid() or user_id = public.workspace_of(auth.uid()));

-- Создание, переименование, порядок и удаление остаются за владельцем: это
-- и есть «структурные изменения трекера», о которых сказал Кирилл. Явно
-- пересоздаются с тем же условием, чтобы правило читалось здесь целиком, а
-- не собиралось из двух миграций.
drop policy if exists "sections_insert_own" on public.sections;
create policy "sections_insert_owner" on public.sections for insert
  with check (user_id = auth.uid());

drop policy if exists "sections_update_own" on public.sections;
create policy "sections_update_owner" on public.sections for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "sections_delete_own" on public.sections;
create policy "sections_delete_owner" on public.sections for delete
  using (user_id = auth.uid());

-- --------------------------------------------- участники своих же задач

-- Кто автор этой задачи. Отдельной функцией и SECURITY DEFINER по той же
-- причине, по которой такими сделаны workspace_of и my_assignee: политика на
-- task_participants, читающая tasks, запускает политику НА tasks, и Postgres
-- останавливает это словами «infinite recursion detected in policy».
create or replace function public.task_author(p_task text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select created_by from public.tasks where id = p_task limit 1
$$;

create or replace function public.meeting_author(p_meeting text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select created_by from public.meetings where id = p_meeting limit 1
$$;

create or replace function public.idea_author(p_idea text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select created_by from public.ideas where id = p_idea limit 1
$$;

revoke all on function public.task_author(text) from public;
revoke all on function public.meeting_author(text) from public;
revoke all on function public.idea_author(text) from public;
grant execute on function public.task_author(text) to authenticated;
grant execute on function public.meeting_author(text) to authenticated;
grant execute on function public.idea_author(text) to authenticated;

-- Ставить людей на СВОЮ задачу. Не «на любую, которую видно»: видно ему и
-- те, где он сам исполнитель, а дописать туда третьего — это уже не участие,
-- а распоряжение чужой работой.
drop policy if exists "task_participants_author_write" on public.task_participants;
create policy "task_participants_author_write" on public.task_participants for all
  using (
    user_id = public.workspace_of(auth.uid())
    and public.task_author(task_participants.task_id) = auth.uid()
  )
  with check (
    user_id = public.workspace_of(auth.uid())
    and public.task_author(task_participants.task_id) = auth.uid()
  );

drop policy if exists "meeting_participants_author_write" on public.meeting_participants;
create policy "meeting_participants_author_write" on public.meeting_participants for all
  using (
    user_id = public.workspace_of(auth.uid())
    and public.meeting_author(meeting_participants.meeting_id) = auth.uid()
  )
  with check (
    user_id = public.workspace_of(auth.uid())
    and public.meeting_author(meeting_participants.meeting_id) = auth.uid()
  );

drop policy if exists "idea_recipients_author_write" on public.idea_recipients;
create policy "idea_recipients_author_write" on public.idea_recipients for all
  using (
    user_id = public.workspace_of(auth.uid())
    and public.idea_author(idea_recipients.idea_id) = auth.uid()
  )
  with check (
    user_id = public.workspace_of(auth.uid())
    and public.idea_author(idea_recipients.idea_id) = auth.uid()
  );

-- ------------------------------------------------------------ что НЕ дано

-- Список людей остаётся владельцевым: приглашения, отключение доступа и
-- отвязка мессенджера — это «Команда», и она за Кириллом. Политика на
-- assignees уже такая (читать всем в пространстве, писать владельцу), и
-- здесь она не трогается — строчка стоит, чтобы следующий читатель не искал
-- её в другой миграции.
comment on table public.assignees is
  'Люди пространства. Читают все участники, меняет только владелец: «Команда» — админская часть (миграции 0019 и 0031).';
