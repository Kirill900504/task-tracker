-- Telegram redelivers a webhook update it didn't get a fast/successful
-- response to (observed in production: repeated unprompted bot replies to
-- the same voice message, minutes apart, while a bug made that message
-- fail). Insert-or-skip on update_id stops reprocessing a redelivered
-- update, regardless of what caused the retry.
create table public.telegram_processed_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);

alter table public.telegram_processed_updates enable row level security;
-- No policies: only the service-role client (used by the webhook route,
-- which bypasses RLS) ever touches this table.
