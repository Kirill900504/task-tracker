-- "Most recently closed first" ordering for the done/resolved lists.
--
-- Until now nothing recorded *when* an item was closed: tasks and meetings
-- only had updated_at (bumped by any edit, not just closing), and ideas had
-- no timestamp beyond created_at at all. Sorting the "показать завершённые"
-- lists by those was close but wrong — editing an old closed item would jump
-- it to the top, which is exactly what these lists must not do, since their
-- job is "let me reopen what I just closed".

alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.meetings add column if not exists resolved_at timestamptz;
alter table public.ideas add column if not exists done_at timestamptz;

-- Backfill so existing history sorts sensibly from day one. updated_at is
-- the best available approximation for rows closed before this migration;
-- ideas have only created_at to fall back on.
update public.tasks set completed_at = updated_at where status = 'done' and completed_at is null;
update public.meetings set resolved_at = updated_at where status <> 'planned' and resolved_at is null;
update public.ideas set done_at = created_at where done = true and done_at is null;

-- Partial indexes: these columns are only ever read for the closed subset.
create index if not exists tasks_completed_at_idx on public.tasks (user_id, completed_at desc) where status = 'done';
create index if not exists meetings_resolved_at_idx on public.meetings (user_id, resolved_at desc) where status <> 'planned';
create index if not exists ideas_done_at_idx on public.ideas (user_id, done_at desc) where done = true;
