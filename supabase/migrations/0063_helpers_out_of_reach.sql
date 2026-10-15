-- The helpers behind the access rules, out of the API's reach.
--
-- Every policy leans on small SECURITY DEFINER functions: who wrote this
-- task, is it closed, which space is this person in, am I on it. They run
-- with the owner's rights on purpose — a policy cannot read the row it is
-- deciding about through the same policy. But they lived in `public`, and
-- Supabase publishes every function in `public` as an endpoint
-- (/rest/v1/rpc/<name>, and a GraphQL field). So any signed-in person could
-- call `task_author('<id>')` and learn who set any task, `item_closed()` to
-- learn whether it is closed, `workspace_of('<user id>')` to learn whose
-- space someone belongs to — bypassing the very rules these functions exist
-- to enforce. Found by the privacy audit of 15.10.2026, the follow-up to
-- 0057 («гарантируешь конфиденциальность?» — not while this stays open).
--
-- They move to the schema `private`, which the API does not publish.
-- Policies keep working untouched: Postgres stores a policy's functions by
-- id, not by name. Function bodies call each other by full name
-- (`public.task_author(`), so every body that mentions a moved function is
-- rewritten to `private.` in the same pass. `busy_slots` stays public — the
-- browser calls it, and it was built to say nothing but «who is busy when».
-- Trigger functions stay where they are: a trigger function cannot be
-- called as an endpoint.
--
-- For whoever writes the next migration: these helpers are now
-- `private.workspace_of(…)`, `private.can_see_item(…)` and so on. A new
-- helper of the same kind belongs in `private` too.

create schema if not exists private;
-- Policies run as the person asking, so the person needs to reach the
-- helpers; reaching them through the API is what the schema takes away.
grant usage on schema private to anon, authenticated, service_role;

do $$
declare
  moved text[] := array[
    'task_author', 'meeting_author', 'idea_author',
    'item_closed', 'comment_item_closed',
    'workspace_of', 'my_assignee', 'my_row_in', 'is_participant',
    'named_in_meeting', 'is_meeting_organizer', 'is_space_admin',
    'can_see_item', 'can_see_task', 'works_on_task', 'can_see_meeting', 'can_see_file'
  ];
  f record;
  def text;
  fixed text;
  n text;
begin
  -- 1. Move. Grants travel with the function.
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = any (moved) and p.prokind = 'f'
  loop
    execute format('alter function %s set schema private', f.sig);
  end loop;

  -- 2. Repoint every body that still calls a moved helper by its old name.
  for f in
    select p.oid
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname in ('public', 'private') and p.prokind = 'f'
  loop
    def := pg_get_functiondef(f.oid);
    fixed := def;
    foreach n in array moved loop
      fixed := replace(fixed, 'public.' || n || '(', 'private.' || n || '(');
    end loop;
    if fixed <> def then
      execute fixed;
    end if;
  end loop;
end
$$;
