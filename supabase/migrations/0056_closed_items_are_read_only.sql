-- Закрытое событие — только просмотр, и обсуждение тоже.
--
-- 14.10.2026, слова Кирилла: «в ранее завершённой задаче и постановщик и
-- исполнитель могут спокойно менять данные, удалять сообщения и
-- переписываться. Запрети любые изменения или дополнения уже закрытых
-- событий. Только просмотр». Интерфейс больше не показывает ни поля
-- ввода, ни «Изменить / Убрать», ни реакций (ItemChat readOnly), но отказ
-- в интерфейсе без отказа в базе — это запрет до первой старой вкладки:
-- окно, открытое до выкладки, живёт на прежнем коде (VersionWatch).
--
-- Закрыто — ровно то же, что считает доска (lib/taskDisplay.isClosed):
-- задача со статусом done или принятая разовая; встреча с исходом
-- (success / no_result — сюда же попадает и перенесённая). Мысли сюда не
-- входят: у них нет «закрытия», о котором договорились люди.
--
-- Что НЕ запрещено, и почему.
-- * Служебный ключ (бот, маршруты, хроника) RLS не видит. Хроника
--   («принял работу», «открыл заново») — это и есть запись о закрытии, её
--   пишет маршрут. Бот проверяет закрытость сам (lib/closedItem).
-- * Документы к решению, которое закрыло событие: приёмка, закрытие
--   невыполненной, итог встречи. Порядок в lib/answerFiles — сначала
--   ответ, потом сообщение с файлами (ответ без файлов хуже, чем файлы без
--   ответа), то есть сообщение приходит, когда событие УЖЕ закрыто. Такая
--   строка узнаётся по подписи «Документы к …» и непустым вложениям.

create or replace function public.item_closed(p_kind text, p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_kind
    when 'task' then exists (
      select 1 from public.tasks
      where id = p_id
        and (status = 'done' or (coalesce(recur, 'none') = 'none' and approval_state = 'accepted'))
    )
    when 'meeting' then exists (
      select 1 from public.meetings where id = p_id and status in ('success', 'no_result')
    )
    else false
  end
$$;

create or replace function public.comment_item_closed(p_comment uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.item_closed(item_kind, item_id) from public.item_comments where id = p_comment), false)
$$;

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
    and (
      not public.item_closed(item_kind, item_id)
      or (body like 'Документы к %' and jsonb_array_length(attachments) > 0)
    )
  );

-- Правка и «Убрать» (это тоже UPDATE — deleted_at) у закрытого запрещены.
drop policy if exists "item_comments_edit_own" on public.item_comments;
create policy "item_comments_edit_own" on public.item_comments for update to authenticated
  using (author_user_id = auth.uid() and system = false and not public.item_closed(item_kind, item_id))
  with check (author_user_id = auth.uid() and system = false);

-- Реакция — тоже дополнение: ни поставить, ни снять.
drop policy if exists "comment_reactions_own" on public.comment_reactions;
create policy "comment_reactions_own" on public.comment_reactions for all
  using ((actor_user_id = auth.uid() or user_id = auth.uid()) and not public.comment_item_closed(comment_id))
  with check ((actor_user_id = auth.uid() or user_id = auth.uid()) and not public.comment_item_closed(comment_id));
