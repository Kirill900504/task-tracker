-- The owner of the space is one of equals: he changes only what he set.
--
-- 06.10.2026, his words: «у меня не должно быть преимуществ и привилегий, у
-- всех равные права!». Until now every write policy on tasks, meetings and
-- ideas began with `user_id = auth.uid()` — "it is in my space, so it is
-- mine" — which let the owner edit, close and delete the work his
-- colleagues had set, and rewrite who is on it. The interface already hides
-- those buttons (lib/ownership.isMine); this is the second half of the same
-- border, because a refusal that lives only in the interface is a refusal
-- that a stale tab or a script walks straight past.
--
-- The owner's own rows carry an EMPTY created_by (the tracker and the bot
-- both write them that way), so "his" is `created_by is null` — or his own
-- id, in case a future path ever stamps it. Reading is deliberately left as
-- it was: who sees what is decided by participation in the tracker, and
-- narrowing reads here would break the catch-up merge that reads the space
-- as a whole.

-- Tasks, meetings, ideas: update and delete only your own.
drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks for update using (
  (user_id = auth.uid() and (created_by is null or created_by = auth.uid()))
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
) with check (
  (user_id = auth.uid() and (created_by is null or created_by = auth.uid()))
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks for delete using (
  (user_id = auth.uid() and (created_by is null or created_by = auth.uid()))
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

drop policy if exists "meetings_update" on public.meetings;
create policy "meetings_update" on public.meetings for update using (
  (user_id = auth.uid() and (created_by is null or created_by = auth.uid()))
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
) with check (
  (user_id = auth.uid() and (created_by is null or created_by = auth.uid()))
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

drop policy if exists "meetings_delete" on public.meetings;
create policy "meetings_delete" on public.meetings for delete using (
  (user_id = auth.uid() and (created_by is null or created_by = auth.uid()))
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

drop policy if exists "ideas_update" on public.ideas;
create policy "ideas_update" on public.ideas for update using (
  (user_id = auth.uid() and (created_by is null or created_by = auth.uid()))
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
) with check (
  (user_id = auth.uid() and (created_by is null or created_by = auth.uid()))
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

drop policy if exists "ideas_delete" on public.ideas;
create policy "ideas_delete" on public.ideas for delete using (
  (user_id = auth.uid() and (created_by is null or created_by = auth.uid()))
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

-- Who is on an item: the owner writes these rows only on his own items, the
-- same as `*_author_write` (migration 0031) lets a manager do on his. The
-- owner's own answers (accepted, reported, voted, seen) never come from the
-- browser — they go through /api/workspace/report with the service key — so
-- nothing of his is lost here.
drop policy if exists "task_participants_owner_write" on public.task_participants;
create policy "task_participants_owner_write" on public.task_participants for all
  using (
    user_id = auth.uid()
    and coalesce(public.task_author(task_participants.task_id), auth.uid()) = auth.uid()
  )
  with check (
    user_id = auth.uid()
    and coalesce(public.task_author(task_participants.task_id), auth.uid()) = auth.uid()
  );

drop policy if exists "meeting_participants_owner_write" on public.meeting_participants;
create policy "meeting_participants_owner_write" on public.meeting_participants for all
  using (
    user_id = auth.uid()
    and coalesce(public.meeting_author(meeting_participants.meeting_id), auth.uid()) = auth.uid()
  )
  with check (
    user_id = auth.uid()
    and coalesce(public.meeting_author(meeting_participants.meeting_id), auth.uid()) = auth.uid()
  );

drop policy if exists "idea_recipients_owner_write" on public.idea_recipients;
create policy "idea_recipients_owner_write" on public.idea_recipients for all
  using (
    user_id = auth.uid()
    and coalesce(public.idea_author(idea_recipients.idea_id), auth.uid()) = auth.uid()
  )
  with check (
    user_id = auth.uid()
    and coalesce(public.idea_author(idea_recipients.idea_id), auth.uid()) = auth.uid()
  );
