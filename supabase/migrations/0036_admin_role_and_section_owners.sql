-- Права администратора перестают быть синонимом «это Кирилл».
--
-- Слова Кирилла 19.09.2026: «в будущем, вероятно, я захочу дать
-- кому-нибудь права администратора и разработчика, чтобы он продолжил
-- работы по улучшению трекера — предусмотри это».
--
-- До сих пор администратор определялся одним вопросом: есть ли на мне
-- строка членства. Нет строки — значит пространство моё, значит можно всё.
-- Отдать эти права кому-то было нельзя вовсе: единственный способ — сделать
-- человека владельцем, то есть отдать ему пространство целиком.
--
-- Колонка `role` в workspace_members есть с самой миграции 0019, но знает
-- ровно два значения. Здесь к ним добавляются ещё два:
--
--   manager    — как было: свои задачи, свои встречи, своё участие.
--   admin      — плюс структура пространства: разделы и их ответственные.
--   developer  — то же, что admin. Отдельным словом, потому что вопрос
--                «кому что можно» задаётся про человека, а не про флаг, и
--                строка «разработчик» в «Команде» объясняет себя сама.
--                Разойдутся они тогда, когда появится первое право,
--                которое стоит дать одному и не дать другому.
--
-- Владелец остаётся владельцем всегда: раздать роли может только он, и ни
-- одна из них не даёт права трогать список людей и приглашения.
--
-- Применяется так:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     supabase/migrations/0036_admin_role_and_section_owners.sql

alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'manager', 'admin', 'developer'));

-- Администратор ЭТОГО пространства — я?
--
-- SECURITY DEFINER по той же причине, что у workspace_of и my_assignee:
-- функция читает workspace_members из политики на другой таблице, и без
-- этого её чтение пошло бы через политики самой workspace_members.
--
-- Владелец отвечает «да» на своё пространство всегда и без строки членства:
-- строки у него нет и быть не должно (см. useWorkspaceRole — отсутствие
-- членства и ЕСТЬ признак владельца).
create or replace function public.is_space_admin(p_space uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_space is not null
     and (
       p_space = auth.uid()
       or exists (
         select 1
           from public.workspace_members
          where owner_id = p_space
            and member_id = auth.uid()
            and status = 'active'
            and role in ('admin', 'developer')
       )
     )
$$;

revoke all on function public.is_space_admin(uuid) from public;
grant execute on function public.is_space_admin(uuid) to authenticated;

-- ------------------------------------------------------------- разделы

-- Миграция 0031 отдала разделы владельцу: читают все, меняет один. Теперь
-- «один» — это владелец ИЛИ тот, кому он дал права. Условие переписано
-- целиком, а не дополнено, чтобы правило читалось в одном месте.
drop policy if exists "sections_insert_owner" on public.sections;
drop policy if exists "sections_insert_admin" on public.sections;
create policy "sections_insert_admin" on public.sections for insert
  with check (public.is_space_admin(user_id));

drop policy if exists "sections_update_owner" on public.sections;
drop policy if exists "sections_update_admin" on public.sections;
create policy "sections_update_admin" on public.sections for update
  using (public.is_space_admin(user_id))
  with check (public.is_space_admin(user_id));

drop policy if exists "sections_delete_owner" on public.sections;
drop policy if exists "sections_delete_admin" on public.sections;
create policy "sections_delete_admin" on public.sections for delete
  using (public.is_space_admin(user_id));

-- ------------------------------------------- кто отвечает за раздел

-- Раздел — это область работы, и у области есть свои люди. Пока их не было
-- записано нигде, каждая задача по «Сервису» начиналась с того, что
-- исполнителей набирали руками — при том что они одни и те же.
--
-- Слова Кирилла: «это я готов заполнить и привязать каждого участника к
-- разделу». Заполняется один раз, а работает в двух местах сразу: правая
-- кнопка по разделу в трекере открывает новую задачу с уже подставленными
-- людьми, и та же привязка даёт боту кнопку «поручить по разделу» вместо
-- выбора людей по одному.
--
-- Роль здесь та же, что у участника задачи, и значит ровно то же самое:
-- подставится она — исполнителем, соисполнителем или наблюдателем.
create table if not exists public.section_assignees (
  id uuid primary key default gen_random_uuid(),
  -- Чьё это пространство. С default auth.uid(), как у всех клиентских
  -- таблиц: без него вставка из браузера отвергается политикой (правило
  -- RLS в заметках проекта — на этом однажды молча сломался sync_errors).
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  section_id text not null references public.sections(id) on delete cascade,
  assignee_id uuid not null references public.assignees(id) on delete cascade,
  role text not null default 'executor' check (role in ('executor', 'coexecutor', 'watcher')),
  created_at timestamptz not null default now(),
  -- Человек стоит в разделе один раз: две строки на одну пару означали бы
  -- два разных ответа на «кем он здесь», и подставлялся бы тот, что попался.
  unique (section_id, assignee_id)
);

alter table public.section_assignees enable row level security;

-- Читают все в пространстве: подстановка нужна каждому, кто заводит задачу,
-- а не только тому, кто эту привязку составил.
drop policy if exists "section_assignees_visible" on public.section_assignees;
create policy "section_assignees_visible" on public.section_assignees for select
  using (user_id = auth.uid() or user_id = public.workspace_of(auth.uid()));

-- Меняет администратор — это структура пространства, ровно как сам раздел.
drop policy if exists "section_assignees_admin_write" on public.section_assignees;
create policy "section_assignees_admin_write" on public.section_assignees for all
  using (public.is_space_admin(user_id))
  with check (public.is_space_admin(user_id));

create index if not exists section_assignees_section_idx
  on public.section_assignees (section_id);

-- Привязка меняется в одном окне и читается в другом — без realtime второе
-- узнавало бы о первом только после перезагрузки.
do $$
begin
  alter publication supabase_realtime add table public.section_assignees;
exception
  when duplicate_object then null;
end
$$;

comment on table public.section_assignees is
  'Кто отвечает за раздел. Подставляется в новую задачу по этому разделу — в трекере правой кнопкой, в боте кнопкой «по разделу» (миграция 0036).';
