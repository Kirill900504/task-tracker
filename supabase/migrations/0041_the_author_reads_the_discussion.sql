-- Постановщик видит обсуждение своей задачи — и может в него писать.
--
-- 24.09.2026 Станислав Синецкий поставил задачу Игорю, открыл её и увидел
-- «Пока тихо» и, на попытке написать, «Нет прав написать сюда». Политика
-- чтения item_comments (миграция 0019) пускала только УЧАСТНИКОВ —
-- тех, кто стоит в task_participants / meeting_participants /
-- idea_recipients. Постановщик, поручивший работу другому, там не стоит:
-- он автор (created_by), а не исполнитель. Строку задачи он при этом
-- видел (tasks_visible знает про created_by), состав тоже
-- (task_participants_author_write), а переписку по ней — нет.
--
-- Отказ на ЗАПИСИ — следствие того же: вставка политику вставки проходила,
-- но клиент просит строку обратно (.insert().select("id")), а вернуть
-- можно только то, что разрешено прочесть. PostgREST сообщает об этом как
-- «new row violates row-level security policy», то есть как отказ писать.
--
-- Владельца это не касалось никогда: его строки — его пространство
-- (user_id = auth.uid()), поэтому ошибка жила у всех, кроме того, кто
-- проверяет трекер первым. Кирилл: «я не предусматривал ограничений
-- кому-то прав» — постановщик и участник в обсуждении равны.
--
-- Автор ищется функциями task_author / meeting_author / idea_author
-- (security definer, из 0031): прочитать tasks изнутри политики через
-- обычный запрос значило бы применить к нему его собственный RLS.

drop policy if exists "item_comments_visible" on public.item_comments;
create policy "item_comments_visible" on public.item_comments for select using (
  user_id = auth.uid()
  or (
    user_id = public.workspace_of(auth.uid())
    and (
      public.is_participant(item_comments.user_id, item_comments.item_kind, item_comments.item_id)
      or auth.uid() = case item_comments.item_kind
        when 'task' then public.task_author(item_comments.item_id)
        when 'meeting' then public.meeting_author(item_comments.item_id)
        else public.idea_author(item_comments.item_id)
      end
    )
  )
);
