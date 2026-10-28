-- One messenger per person, chosen by the person.
--
-- 28.10.2026 Кирилл: «сделай возможность выбрать только один бот,
-- приоритетный конечно MAX, но и телеграмм должен быть доступен для
-- выбора». Until now a colleague connected to both got everything in
-- whichever came first in the code's channel list (Telegram), and the owner
-- got every message twice — once in each.
--
-- NULL means "not chosen" and reads as MAX: the default he named, without
-- rewriting every existing row. The choice only matters to someone connected
-- to both; with one messenger connected, that one is used whatever this says.
-- The owner's choice lives on his own «(я)» row too — his chats are in the
-- accounts tables, but the person is that row.
alter table public.assignees add column if not exists messenger text;

alter table public.assignees drop constraint if exists assignees_messenger_check;
alter table public.assignees add constraint assignees_messenger_check
  check (messenger is null or messenger in ('max', 'telegram'));

-- Readable from the browser like the other messenger columns (0057 grants
-- select column by column, so a new column is invisible until named here).
-- Written only by /api/account/messenger with the service key.
grant select (messenger) on public.assignees to authenticated;
