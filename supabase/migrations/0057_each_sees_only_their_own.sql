-- Each person reads only what is theirs — the owner of the space included.
--
-- 23.09.2026 the tracker learned to show every person only what they set
-- or take part in, and Кирилл said it outright: «это правило касается и
-- меня». The screen has followed that since. The database did not: every
-- read policy began with `user_id = auth.uid()`, and since the owner's id
-- IS the space's `user_id`, that clause let him read the whole space — every
-- manager's tasks, meetings, private thoughts and discussions. The screen
-- filtered them out after they had already arrived in his browser (and in
-- its offline copy, and in every realtime event). 14.10.2026, after
-- discussion messages from tasks he is not on reached his messenger, he
-- asked for a strict guarantee that nothing leaks to anyone «ни в качестве
-- уведомлений ни в других формах». A filter on the screen is not that
-- guarantee; the database is.
--
-- The rule is now the same for everybody and lives in one function,
-- `can_see_item`: you see an item if you are in its space AND you set it
-- or take part in it. "Set it" is `coalesce(created_by, owner)` — the
-- owner's own rows have no author written down (lib/ownership), so an empty
-- author means the owner and nobody else. "Take part" is a participation
-- row for your own person row; for a meeting also your name in its list,
-- because that is how the screen decides it (lib/itemVisibility) and the
-- two must agree, or the owner loses meetings he can see today.
--
-- Also closed here, found by the same audit:
--  * attachments: any member could read — and LIST — every file of the
--    space, because the storage policy looked only at the first folder (the
--    space). Now a file is readable by whoever uploaded it and by whoever
--    can see the item it belongs to;
--  * reactions were readable across the whole space;
--  * `assignees` is the shared people list, readable by every member, and
--    it carried the bot's unfinished conversations (`pending_action` can
--    hold a dictated task before «да»). Those columns are now server-only;
--  * the meeting form checks who is busy against the meetings the browser
--    has. With the owner narrowed to his own, that check would miss other
--    people's meetings — and for managers it always had. `busy_slots`
--    answers the question without the content: person, day, start, length.
--    No title, no outcome, no meeting id.

-- ---------------------------------------------------------------------------
-- "My person row in this space" — now the owner's too.
--
-- The owner has no membership row; his row in the people list is the one
-- marked «(я)» (lib/trackerRows.isSelfAssignee). Without this branch
-- `is_participant` was always false for him, which did not matter while his
-- policies let him read everything anyway.
create or replace function public.my_assignee(p_owner uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select assignee_id
       from public.workspace_members
      where owner_id = p_owner
        and member_id = auth.uid()
        and status = 'active'
      limit 1),
    (select id
       from public.assignees
      where p_owner = auth.uid()
        and user_id = p_owner
        and rtrim(name) like '%(я)'
      order by created_at
      limit 1)
  )
$$;

-- Am I named in this meeting's list of participants?
create or replace function public.named_in_meeting(p_owner uuid, p_meeting text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.meetings m
      join public.assignees a on a.id = public.my_assignee(p_owner)
     where m.id = p_meeting
       and a.name = any(m.participants)
  )
$$;

-- The one visibility rule.
create or replace function public.can_see_item(p_owner uuid, p_kind text, p_item text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (p_owner = auth.uid() or p_owner = public.workspace_of(auth.uid()))
     and (
       auth.uid() = coalesce(
         case p_kind
           when 'task' then public.task_author(p_item)
           when 'meeting' then public.meeting_author(p_item)
           else public.idea_author(p_item)
         end,
         p_owner)
       or public.is_participant(p_owner, p_kind, p_item)
       or (p_kind = 'meeting' and public.named_in_meeting(p_owner, p_item))
     )
$$;

-- The agenda already asked this question under its own name; it now asks
-- the shared one, so the two cannot drift.
create or replace function public.can_see_meeting(p_owner uuid, p_meeting text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_see_item(p_owner, 'meeting', p_meeting)
$$;

-- ---------------------------------------------------------------------------
-- The items themselves. Written against the row's own columns rather than
-- through can_see_item: same rule, one lookup fewer per row.

drop policy if exists tasks_visible on public.tasks;
create policy tasks_visible on public.tasks for select using (
  (user_id = auth.uid() or user_id = public.workspace_of(auth.uid()))
  and (coalesce(created_by, user_id) = auth.uid() or public.is_participant(user_id, 'task', id))
);

drop policy if exists meetings_visible on public.meetings;
create policy meetings_visible on public.meetings for select using (
  (user_id = auth.uid() or user_id = public.workspace_of(auth.uid()))
  and (
    coalesce(created_by, user_id) = auth.uid()
    or public.is_participant(user_id, 'meeting', id)
    or exists (select 1 from public.assignees a where a.id = public.my_assignee(user_id) and a.name = any(participants))
  )
);

drop policy if exists ideas_visible on public.ideas;
create policy ideas_visible on public.ideas for select using (
  (user_id = auth.uid() or user_id = public.workspace_of(auth.uid()))
  and (coalesce(created_by, user_id) = auth.uid() or public.is_participant(user_id, 'idea', id))
);

-- ---------------------------------------------------------------------------
-- What hangs off an item is visible exactly when the item is.

drop policy if exists item_comments_visible on public.item_comments;
create policy item_comments_visible on public.item_comments for select using (
  public.can_see_item(user_id, item_kind, item_id)
);

drop policy if exists task_participants_visible on public.task_participants;
create policy task_participants_visible on public.task_participants for select using (
  public.can_see_item(user_id, 'task', task_id)
);

drop policy if exists meeting_participants_visible on public.meeting_participants;
create policy meeting_participants_visible on public.meeting_participants for select using (
  public.can_see_item(user_id, 'meeting', meeting_id)
);

-- A thought's recipients: its author sees all of them, a recipient sees only
-- their own row (who else got the same thought is the author's business —
-- migration 0050). Same for the owner now.
drop policy if exists idea_recipients_visible on public.idea_recipients;
create policy idea_recipients_visible on public.idea_recipients for select using (
  (user_id = auth.uid() or user_id = public.workspace_of(auth.uid()))
  and (coalesce(public.idea_author(idea_id), user_id) = auth.uid() or assignee_id = public.my_assignee(user_id))
);

drop policy if exists comment_reactions_visible on public.comment_reactions;
create policy comment_reactions_visible on public.comment_reactions for select using (
  exists (
    select 1 from public.item_comments c
     where c.id = comment_reactions.comment_id
       and public.can_see_item(c.user_id, c.item_kind, c.item_id)
  )
);

-- ---------------------------------------------------------------------------
-- Attachments: <space>/<task|meeting|idea>/<item id>/… — readable by the
-- uploader and by whoever can see that item. A path of any other shape is
-- readable by nobody but its uploader.
create or replace function public.can_see_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  parts text[] := storage.foldername(p_name);
  space uuid;
begin
  if coalesce(array_length(parts, 1), 0) < 3 or parts[2] not in ('task', 'meeting', 'idea') then
    return false;
  end if;
  begin
    space := parts[1]::uuid;
  exception when others then
    return false;
  end;
  return public.can_see_item(space, parts[2], parts[3]);
end
$$;

drop policy if exists item_files_read on storage.objects;
create policy item_files_read on storage.objects for select using (
  bucket_id = 'item-files' and (owner = auth.uid() or public.can_see_file(name))
);

-- ---------------------------------------------------------------------------
-- The people list is shared; the bot's memory about a conversation is not.
revoke select on public.assignees from anon, authenticated;
grant select (
  id, user_id, name, created_at,
  telegram_chat_id, telegram_username, linked_at,
  max_user_id, max_username, max_linked_at,
  away_until, away_kind, archived_at
) on public.assignees to authenticated;

-- ---------------------------------------------------------------------------
-- Who is busy when, without what they are busy with.
--
-- Planned meetings of my space from today on that I can NOT see — the ones
-- I can see the browser already has, with their ids, so the form can leave
-- out the meeting being moved. One row per person per meeting.
create or replace function public.busy_slots()
returns table (person text, date date, "time" text, duration_min integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.name, m.date, m.time, m.duration_min
    from public.meetings m
    cross join lateral unnest(m.participants) as p(name)
   where m.user_id = coalesce(public.workspace_of(auth.uid()), auth.uid())
     and m.deleted_at is null
     and m.status = 'planned'
     and m.date >= (now() at time zone 'Europe/Moscow')::date
     and not public.can_see_item(m.user_id, 'meeting', m.id)
$$;

revoke execute on function public.busy_slots() from public, anon;
grant execute on function public.busy_slots() to authenticated;
