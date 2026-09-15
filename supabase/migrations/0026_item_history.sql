-- История задачи — в её же обсуждении.
--
-- «Вернули на доработку» стирает отчёт: done_at и done_comment обнуляются,
-- иначе задача осталась бы в состоянии «отчитались все» и приёмка
-- предложилась бы снова (см. /api/workspace/review). Это правильно для
-- состояния и разрушительно для памяти: после второго круга уже не видно,
-- что человек сдавал в первый раз и что именно его просили доделать.
--
-- Соблазн — завести таблицу событий. Здесь это было бы третьей правдой об
-- одном факте, а этот проект уже дважды платил за такие (см. правило «две
-- правды расходятся» в CLAUDE.md). Обсуждение задачи уже существует, уже
-- показывает время и автора, уже видно всем участникам и уже доходит до
-- мессенджеров. Ему не хватало одного: возможности сказать что-то не от
-- имени человека.
--
-- Отсюда один флаг. Системная запись — не чьё-то сообщение: её нельзя
-- править, на неё не ставят реакции, она не считается «в обсуждении
-- писали» в утренней сводке и выглядит строкой хроники, а не репликой.
--
-- Применяется так:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     supabase/migrations/0026_item_history.sql

alter table public.item_comments
  add column if not exists system boolean not null default false;

comment on column public.item_comments.system is
  'Запись хроники, а не сообщение человека: принял, отчитался, вернули на доработку. Пишется только сервером.';

-- Права на колонку отдельно не выдаются и не нужны: authenticated читает
-- строку целиком по прежней политике, а пишет системные записи только
-- служебный клиент. Но написать `system = true` из браузера человек не
-- должен уметь — иначе он подделает хронику собственной задачи.
drop policy if exists "item_comments_write" on public.item_comments;
create policy "item_comments_write" on public.item_comments for insert to authenticated
  with check (
    system = false
    and (
      (user_id = auth.uid() and author_user_id = auth.uid())
      or (
        user_id = workspace_of(auth.uid())
        and author_user_id = auth.uid()
        and author_assignee_id = my_assignee(user_id)
      )
    )
  );

-- Править и убирать можно только свои собственные реплики. Системную
-- запись не может тронуть никто: у неё нет автора, и условие ниже её не
-- пропускает само по себе — но сказать это прямо дешевле, чем однажды
-- выяснить обратное.
drop policy if exists "item_comments_edit_own" on public.item_comments;
create policy "item_comments_edit_own" on public.item_comments for update to authenticated
  using (author_user_id = auth.uid() and system = false)
  with check (author_user_id = auth.uid() and system = false);
