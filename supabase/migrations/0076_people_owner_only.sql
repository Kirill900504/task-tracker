-- The people list is written by the space owner only, and a chat is never
-- attached from the browser (30.10.2026, third pass of the sign-in audit).
--
-- 1. "assignees_insert_own" checked `user_id = auth.uid()`, which a manager
--    satisfies for a row in a "space" of his own. Such rows are invisible in
--    the tracker but not to the bot: findColleagueByChat looks a chat up
--    across ALL rows. A manager could write a row carrying a colleague's
--    Telegram id; from then on the colleague's chat could resolve to that
--    row — his buttons answered «not for you», and the mini-app built him a
--    cabinet inside the manager's empty space, where the manager is owner.
--    Writing people is the owner's: someone who is nobody's member.
--
-- 2. A chat column set from the browser is a sign-in handed out by whoever
--    typed it — even by the owner: binding his own second Telegram account
--    to a colleague's row would let him open the mini-app as that colleague,
--    which the privacy rule closes to him. Chats are attached only by the bot
--    with a link code (service role); the browser may only CLEAR them
--    («Отвязать» in «Команда»).
-- "Owner" = has no membership at all, active or not: workspace_of() looks
-- only at active rows, and a disabled manager is still nobody's owner.
create or replace function private.is_space_owner(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.workspace_members where member_id = p_user)
$$;
revoke all on function private.is_space_owner(uuid) from public;
grant execute on function private.is_space_owner(uuid) to authenticated;

drop policy if exists "assignees_insert_own" on public.assignees;
create policy "assignees_insert_own" on public.assignees
  for insert with check (user_id = auth.uid() and private.is_space_owner(auth.uid()));

drop policy if exists "assignees_update_own" on public.assignees;
create policy "assignees_update_own" on public.assignees
  for update using (user_id = auth.uid() and private.is_space_owner(auth.uid()))
  with check (user_id = auth.uid() and private.is_space_owner(auth.uid()));

drop policy if exists "assignees_delete_own" on public.assignees;
create policy "assignees_delete_own" on public.assignees
  for delete using (user_id = auth.uid() and private.is_space_owner(auth.uid()));

create or replace function private.assignee_chat_guard()
returns trigger
language plpgsql
as $$
begin
  -- The service role (bot, API routes) is not limited here.
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.telegram_chat_id is not null or new.max_user_id is not null then
      raise exception 'chat is attached by the bot only' using errcode = '42501';
    end if;
  else
    if (new.telegram_chat_id is not null and new.telegram_chat_id is distinct from old.telegram_chat_id)
       or (new.max_user_id is not null and new.max_user_id is distinct from old.max_user_id) then
      raise exception 'chat is attached by the bot only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assignees_chat_guard on public.assignees;
create trigger assignees_chat_guard
  before insert or update on public.assignees
  for each row execute function private.assignee_chat_guard();
