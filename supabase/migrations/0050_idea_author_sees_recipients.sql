-- Автор мысли видит, кому он её отправил.
--
-- 07.10.2026 Кирилл попросил показывать при наведении на мысль, кому она
-- уже ушла. Строки рассылки (`idea_recipients`) для этого есть с 0019, но
-- читать их могли двое: владелец пространства (строки пишутся на его
-- user_id) и сам получатель — свою строку. Руководитель, отправивший
-- СВОЮ мысль, своих же строк рассылки не видел: та же дыра, что 0041
-- закрыла у обсуждения, — автор не участник, и политика «по участию» о
-- нём не знает. Владельца это не касается никогда, поэтому проверявший
-- первым её бы не заметил.
--
-- Автор ищется функцией idea_author (security definer, из 0031):
-- прочитать ideas изнутри политики обычным запросом значило бы применить
-- к нему его собственный RLS.

drop policy if exists "idea_recipients_visible" on public.idea_recipients;
create policy "idea_recipients_visible" on public.idea_recipients for select using (
  user_id = auth.uid()
  or (
    user_id = public.workspace_of(auth.uid())
    and (
      assignee_id = public.my_assignee(user_id)
      or public.idea_author(idea_recipients.idea_id) = auth.uid()
    )
  )
);
