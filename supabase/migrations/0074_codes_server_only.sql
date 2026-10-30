-- Link codes and invitations are written by the server only (30.10.2026,
-- second sign-in audit).
--
-- A link code is a sign-in: whoever presses «Start» with it becomes the
-- person in `assignee_id`, cabinet and all. The browser policy from 0003
-- checked only `user_id = auth.uid()`, so ANY signed-in member could insert
-- a code of their own with a colleague's assignee_id in it, open the bot
-- with it, and from then on sign in as that colleague — the owner was not
-- even told, the "someone connected" notice going to the code's user_id,
-- i.e. to the attacker. workspace_invites had the same shape through
-- `owner_id = auth.uid()`.
--
-- Nothing in the browser reads or writes either table: every code is issued
-- by an API route with the service role, which checks who may issue it.
-- So the browser loses them entirely, like bot_messages and login_requests.
drop policy if exists "telegram_link_codes_select_own" on public.telegram_link_codes;
drop policy if exists "telegram_link_codes_insert_own" on public.telegram_link_codes;
drop policy if exists "telegram_link_codes_delete_own" on public.telegram_link_codes;
revoke all on public.telegram_link_codes from anon, authenticated;

drop policy if exists "workspace_invites_owner_all" on public.workspace_invites;
revoke all on public.workspace_invites from anon, authenticated;
