-- Follow-up fix: this column was added to 0003_telegram.sql's definition
-- after it had already been shown for execution — applying it separately
-- rather than asking for a second full run of that file.
alter table public.telegram_accounts add column if not exists pending_context text;
