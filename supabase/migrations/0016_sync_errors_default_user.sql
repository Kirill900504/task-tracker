-- sync_errors.user_id had no default, unlike every other user-owned table.
-- The tracker records a failed save as insert({ message }) — with no user_id
-- to fill the column, that insert was rejected by the table's own RLS policy
-- (user_id = auth.uid() can never hold for a null), silently, inside a
-- best-effort try/catch. The upshot: no failed save was ever recorded, and
-- the banner that reports them on the next visit had nothing to show.
alter table public.sync_errors
  alter column user_id set default auth.uid();
