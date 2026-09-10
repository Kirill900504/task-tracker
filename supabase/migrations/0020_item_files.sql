-- Файлы в обсуждении.
--
-- «Покажи, что сделал» — половина отчётов в этой компании: фотография
-- установленной кассы, скан акта, скриншот выгрузки. До сих пор всё это
-- уходило в WhatsApp, потому что в задаче показать было нечего, и вместе с
-- фотографией туда же уходил и разговор.
--
-- Хранилище отдельное от базы (Supabase Storage), поэтому здесь три вещи:
-- корзина, права на неё и колонка, которая связывает файл с сообщением.
--
-- Путь файла — `<владелец>/<вид>/<id элемента>/<имя>`. Первый сегмент и
-- есть пространство: права ниже читают именно его, так что чужую корзину
-- не открыть, даже зная имя файла.

-- ------------------------------------------------------------- корзина

insert into storage.buckets (id, name, public, file_size_limit)
values ('item-files', 'item-files', false, 20971520)
on conflict (id) do nothing;

-- --------------------------------------------------------------- права

-- Видит файл тот, кто видит пространство: владелец — своё, руководитель —
-- то, в которое он принят. Точнее (по конкретной задаче) права здесь дать
-- нельзя: storage.objects ничего не знает про участников, а тащить туда
-- эту проверку значило бы держать её в двух местах и однажды разойтись.
-- Поэтому граница проходит по пространству, а не по элементу.
drop policy if exists "item_files_read" on storage.objects;
create policy "item_files_read" on storage.objects for select to authenticated
using (
  bucket_id = 'item-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (storage.foldername(name))[1] = public.workspace_of(auth.uid())::text
  )
);

drop policy if exists "item_files_write" on storage.objects;
create policy "item_files_write" on storage.objects for insert to authenticated
with check (
  bucket_id = 'item-files'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (storage.foldername(name))[1] = public.workspace_of(auth.uid())::text
  )
);

-- Удалить можно только то, что загрузил сам. Чужое вложение из чужого
-- сообщения — такая же чужая запись, как и текст этого сообщения.
drop policy if exists "item_files_delete" on storage.objects;
create policy "item_files_delete" on storage.objects for delete to authenticated
using (bucket_id = 'item-files' and owner = auth.uid());

-- ------------------------------------------------------------ вложения

-- Список, а не одна колонка: к сообщению прикладывают и две фотографии.
-- jsonb, а не своя таблица: вложение не живёт отдельно от сообщения, не
-- ищется само по себе и умирает вместе с ним.
alter table public.item_comments
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.item_comments.attachments is
  'Массив {path, name, size, type} — путь в корзине item-files, имя как его видел человек.';
