-- Memberships are created and removed by the server only (30.10.2026,
-- second sign-in audit, reproduced against production before the fix).
--
-- "workspace_members_owner_all" checked only `owner_id = auth.uid()`, which
-- every signed-in person satisfies for a row naming THEMSELVES as owner. So
-- any manager could insert a membership {owner_id: me, member_id: <the real
-- owner's login>, assignee_id: <my own row>}. From then on everything that
-- asks "where does this login live" got the forged answer: workspace_of()
-- moved the owner into an empty space (his tracker went blank), and
-- lib/accountChat — "where to send this login's password link" — read the
-- forged row and sent the owner's recovery link to the manager's chat.
--
-- In the browser the owner only ever changes a person's role and
-- direction; joining, disabling and removing go through API routes with the
-- service role. So the browser keeps exactly that: read, and update of those
-- two columns on rows of his own space whose person is his own.
drop policy if exists "workspace_members_owner_all" on public.workspace_members;

drop policy if exists "workspace_members_owner_read" on public.workspace_members;
create policy "workspace_members_owner_read" on public.workspace_members
  for select using (owner_id = auth.uid());

drop policy if exists "workspace_members_owner_update" on public.workspace_members;
create policy "workspace_members_owner_update" on public.workspace_members
  for update
  using (owner_id = auth.uid() and exists (select 1 from public.assignees a where a.id = assignee_id and a.user_id = auth.uid()))
  with check (owner_id = auth.uid() and exists (select 1 from public.assignees a where a.id = assignee_id and a.user_id = auth.uid()));

revoke insert, update, delete on public.workspace_members from anon, authenticated;
grant update (role, direction) on public.workspace_members to authenticated;
