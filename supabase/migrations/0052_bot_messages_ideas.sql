-- Сообщение с мыслью тоже запоминается — чтобы ответ, данный в трекере или
-- в другом мессенджере, переписал его и снял кнопки.
--
-- 08.10.2026: получатель нажимал «Принял» в трекере, а в Telegram под той
-- же мыслью так и висели «Прочитать / Сохранить / В работу / Встреча» —
-- то есть мессенджер врал, что ответа нет, и предлагал ответить второй
-- раз. Задачи и встречи синхронны с 0044 (lib/botMirror); мысли туда не
-- попадали, потому что ограничение пускало только их.
alter table public.bot_messages drop constraint if exists bot_messages_item_kind_check;
alter table public.bot_messages
  add constraint bot_messages_item_kind_check check (item_kind in ('task', 'meeting', 'idea'));
