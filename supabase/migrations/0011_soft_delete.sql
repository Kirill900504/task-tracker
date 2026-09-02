-- Soft delete (spec-audit recommendation #4): deleting a task/meeting/idea
-- now marks it, rather than physically removing the row — recoverable
-- indefinitely instead of only within a 6-second undo-toast window.
alter table public.tasks add column deleted_at timestamptz;
alter table public.meetings add column deleted_at timestamptz;
alter table public.ideas add column deleted_at timestamptz;
