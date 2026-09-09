-- The tracker stops being single-player.
--
-- Until now there was exactly one kind of person here: the owner. Everything
-- else was addressed by NAME — `tasks.assignee` is a string, a meeting's
-- participants are an array of strings, and a "colleague" is a row in
-- `assignees` with a messenger chat glued to it. That was enough while the
-- only thing a colleague could do was press a button in Telegram.
--
-- It is not enough for what this has to become: fourteen managers who sign
-- in, who are executors / co-executors / watchers rather than "the
-- assignee", who confirm a task each for himself, who vote on a meeting and
-- have to say why when they decline, and who talk in the item itself
-- instead of in a chat somewhere else.
--
-- The shape chosen here, and the reason for it:
--
-- 1. A WORKSPACE IS AN OWNER. There is no `workspaces` table and no
--    `workspace_id` column, because every row in this database already
--    carries `user_id` = the owner it belongs to. Making the owner's id BE
--    the workspace identity means not one existing row has to move, not one
--    existing query changes, and RLS keeps working exactly as it did for the
--    owner himself. A manager is simply someone who is allowed to look into
--    somebody else's `user_id`.
--
-- 2. A MEMBER IS AN ASSIGNEE THAT LEARNED TO SIGN IN. The managers already
--    exist as `assignees` rows — that is what tasks and meetings point at by
--    name. Membership links that row to an auth user instead of replacing
--    it, so a person can be invited into the web app without breaking the
--    messenger flow that already addresses him, and a colleague who never
--    signs in keeps working exactly as before.
--
-- 3. PARTICIPATION IS A ROW, NOT A COLUMN. `tasks.assignee` cannot express
--    "four people, two of whom must each report separately". The
--    participant tables carry the role and every individual's own state —
--    accepted, done with his comment, or declined with his reason.
--    `tasks.assignee` stays and is still written: it is what the existing
--    UI, the bot, the briefing and 190 tests read. Nothing is migrated away
--    in this step; the new tables are additive, and the old column becomes
--    the "primary executor" shorthand.
--
-- Applied with:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     supabase/migrations/0019_workspace_roles_participants.sql

-- ---------------------------------------------------------------- members

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  -- Whose workspace this is. Not `default auth.uid()`: rows here are created
  -- by the owner for somebody else, so it is always passed explicitly.
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- The auth user, once the invitation has actually been accepted. Null
  -- until then: the person exists in the tracker (as an assignee) before he
  -- exists as a login.
  member_id uuid references auth.users(id) on delete set null,
  -- Who this person IS in the tracker — the row tasks and meetings name.
  assignee_id uuid not null references public.assignees(id) on delete cascade,
  role text not null default 'manager' check (role in ('owner', 'manager')),
  status text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  -- Which of the ten directions he heads. Free text on purpose: the list
  -- changes faster than a migration can, and nothing branches on it yet.
  direction text not null default '',
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  disabled_at timestamptz,
  unique (owner_id, assignee_id)
);

-- One login belongs to one workspace. The helper functions below rely on
-- this to answer "whose workspace is this person in" without a parameter,
-- and a person in two workspaces would make every policy ambiguous. If that
-- ever has to change it changes here, deliberately, not by accident.
create unique index if not exists workspace_members_member_idx
  on public.workspace_members (member_id)
  where member_id is not null;

-- Leaving the company (A4): the login is switched off and everything the
-- person was on stays exactly where it is, so his tasks surface as
-- "исполнитель отключён" rather than vanishing with him.
comment on column public.workspace_members.status is
  'invited: sent, not accepted. active: can sign in. disabled: left the company — data kept, access gone.';

-- --------------------------------------------------------------- invites

-- Deliberately shaped like telegram_link_codes: a short-lived code that the
-- owner hands out, exchanged once for a membership. There is no open
-- sign-up — a person exists here because Кирилл added him, and that is the
-- whole registration policy.
create table if not exists public.workspace_invites (
  code text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  assignee_id uuid not null references public.assignees(id) on delete cascade,
  -- Optional: only so the invite can be emailed and so an accepted invite
  -- can be matched against the address it was sent to.
  email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);

-- ------------------------------------------------------- helper functions

-- Both are SECURITY DEFINER on purpose. They are called from inside RLS
-- policies, and a policy that reads a table which is itself protected by a
-- policy recurses. Defining them here, once, keeps every policy below a
-- plain boolean expression.

-- Whose workspace does this login belong to (null for the owner himself,
-- who belongs to his own by being it).
create or replace function public.workspace_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select owner_id
    from public.workspace_members
   where member_id = p_user
     and status = 'active'
   limit 1
$$;

-- Which assignee row the current login is, inside a given workspace. This is
-- the bridge between "who is signed in" and "whose name is on the task".
create or replace function public.my_assignee(p_owner uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select assignee_id
    from public.workspace_members
   where owner_id = p_owner
     and member_id = auth.uid()
     and status = 'active'
   limit 1
$$;

revoke all on function public.workspace_of(uuid) from public;
revoke all on function public.my_assignee(uuid) from public;
grant execute on function public.workspace_of(uuid) to authenticated;
grant execute on function public.my_assignee(uuid) to authenticated;

-- --------------------------------------------------- who set what, and how

alter table public.tasks
  -- Null means the owner, which is every task that exists today. A manager
  -- may set tasks too — on anyone, including on Кирилл.
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  -- B4: "he reported" and "I checked" are different events. Once every
  -- executor has reported, the task waits for the person who set it.
  add column if not exists approval_state text not null default 'open'
    check (approval_state in ('open', 'awaiting_review', 'accepted', 'returned')),
  add column if not exists approval_comment text,
  add column if not exists approved_at timestamptz,
  -- B2: closing a task over the head of an executor who is dragging. Kept
  -- as its own pair of columns rather than a status, because the fact that
  -- it was forced is exactly what must not be lost.
  add column if not exists force_closed_by uuid references auth.users(id) on delete set null,
  add column if not exists force_closed_reason text;

alter table public.meetings
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  -- C3: moving a meeting invalidates every answer given about the old time,
  -- so the round is bumped and everyone votes again. Answers from earlier
  -- rounds are kept — "он и в прошлый раз не пришёл" is worth seeing.
  add column if not exists vote_round int not null default 1,
  -- C4: the recap belongs to whoever called the meeting.
  add column if not exists result_by uuid references auth.users(id) on delete set null,
  add column if not exists result_at timestamptz;

alter table public.ideas
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- ---------------------------------------------------------- participants

create table if not exists public.task_participants (
  id uuid primary key default gen_random_uuid(),
  -- The workspace owner. Filled by the trigger below from the parent task,
  -- never trusted from the client: a manager inserting a participant would
  -- otherwise stamp his own id here and the row would belong to the wrong
  -- workspace. (CLAUDE.md: every user table needs user_id, or client
  -- inserts are silently rejected by RLS.)
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  assignee_id uuid not null references public.assignees(id) on delete cascade,
  -- Only executors have to report (B1). Co-executors help, watchers watch;
  -- neither can hold the task open.
  role text not null default 'executor'
    check (role in ('executor', 'coexecutor', 'watcher')),
  accepted_at timestamptz,
  done_at timestamptz,
  -- B5: mandatory when reporting done, and deliberately not length-limited —
  -- a rule that forces words produces the word "ок".
  done_comment text,
  -- B3: the third door. Without it a manager who cannot do the task simply
  -- goes quiet, which is the exact failure this whole system exists to stop.
  declined_at timestamptz,
  decline_reason text,
  -- B6: an executor may ask for a new deadline, never set one.
  reschedule_requested_at timestamptz,
  reschedule_to date,
  reschedule_reason text,
  created_at timestamptz not null default now(),
  unique (task_id, assignee_id)
);

create index if not exists task_participants_task_idx on public.task_participants (task_id);
create index if not exists task_participants_assignee_idx on public.task_participants (assignee_id);

create table if not exists public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  assignee_id uuid not null references public.assignees(id) on delete cascade,
  role text not null default 'participant'
    check (role in ('organizer', 'participant', 'watcher')),
  -- C1/C2: 'none' is not the absence of an answer, it is a visible state —
  -- "не ответили: трое" is a line in the owner's card.
  response text not null default 'none' check (response in ('none', 'yes', 'no')),
  -- Mandatory when the answer is "no". Same reasoning as done_comment.
  reason text,
  responded_at timestamptz,
  -- Which round of voting this answer belongs to. An answer from an earlier
  -- round is history, not a confirmation of the current time.
  round int not null default 1,
  created_at timestamptz not null default now(),
  unique (meeting_id, assignee_id)
);

create index if not exists meeting_participants_meeting_idx on public.meeting_participants (meeting_id);

-- A thought sent to someone. Thinner than the other two on purpose: a
-- thought carries no obligation and nothing to confirm — the only question
-- is whether the person took it into work, and that is answered by the task
-- or meeting he then creates from it.
create table if not exists public.idea_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  assignee_id uuid not null references public.assignees(id) on delete cascade,
  seen_at timestamptz,
  -- What it became, if anything.
  converted_task_id uuid references public.tasks(id) on delete set null,
  converted_meeting_id uuid references public.meetings(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (idea_id, assignee_id)
);

create index if not exists idea_recipients_idea_idx on public.idea_recipients (idea_id);

-- The workspace of a participant row is never the workspace of whoever
-- inserted it — it is the workspace of the item. One trigger per table
-- rather than trusting the caller, because getting this wrong does not
-- fail loudly: the row simply becomes invisible to the people who need it.
create or replace function public.set_participant_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_owner uuid;
begin
  if tg_table_name = 'task_participants' then
    select user_id into parent_owner from public.tasks where id = new.task_id;
  elsif tg_table_name = 'meeting_participants' then
    select user_id into parent_owner from public.meetings where id = new.meeting_id;
  else
    select user_id into parent_owner from public.ideas where id = new.idea_id;
  end if;

  if parent_owner is null then
    raise exception 'participant references an item that does not exist';
  end if;

  new.user_id = parent_owner;
  return new;
end;
$$;

drop trigger if exists task_participants_workspace on public.task_participants;
create trigger task_participants_workspace before insert or update on public.task_participants
  for each row execute function public.set_participant_workspace();

drop trigger if exists meeting_participants_workspace on public.meeting_participants;
create trigger meeting_participants_workspace before insert or update on public.meeting_participants
  for each row execute function public.set_participant_workspace();

drop trigger if exists idea_recipients_workspace on public.idea_recipients;
create trigger idea_recipients_workspace before insert or update on public.idea_recipients
  for each row execute function public.set_participant_workspace();

-- ---------------------------------------------------- talking about a task

-- One table for every kind of item, rather than task_comments +
-- meeting_comments + idea_comments. The conversation is identical in all
-- three, and three tables would mean three sets of policies to keep in step.
-- The price is that there is no foreign key to the parent (Postgres has no
-- polymorphic references) — hence the trigger, which both resolves the
-- workspace and refuses a comment on an item that does not exist.
create table if not exists public.item_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_kind text not null check (item_kind in ('task', 'meeting', 'idea')),
  item_id uuid not null,
  -- Who said it. A signed-in manager has both; a colleague answering from
  -- Telegram has only the assignee. Both are recorded so a name can always
  -- be shown, whichever door the message came through.
  author_assignee_id uuid references public.assignees(id) on delete set null,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null,
  -- Which messenger (or the app) it arrived from — worth keeping for the
  -- same reason the AI action log keeps its source.
  source text not null default 'app' check (source in ('app', 'telegram', 'max')),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists item_comments_item_idx on public.item_comments (item_kind, item_id, created_at);

create or replace function public.set_comment_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_owner uuid;
begin
  if new.item_kind = 'task' then
    select user_id into parent_owner from public.tasks where id = new.item_id;
  elsif new.item_kind = 'meeting' then
    select user_id into parent_owner from public.meetings where id = new.item_id;
  else
    select user_id into parent_owner from public.ideas where id = new.item_id;
  end if;

  if parent_owner is null then
    raise exception 'comment references an item that does not exist';
  end if;

  new.user_id = parent_owner;
  return new;
end;
$$;

drop trigger if exists item_comments_workspace on public.item_comments;
create trigger item_comments_workspace before insert on public.item_comments
  for each row execute function public.set_comment_workspace();

-- D4: a fixed set, not arbitrary emoji. Anything chosen here has to survive
-- the trip into Telegram and MAX, where a message is text and a reaction is
-- a line under it — an open set would render as mojibake for somebody.
create table if not exists public.comment_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  comment_id uuid not null references public.item_comments(id) on delete cascade,
  actor_assignee_id uuid references public.assignees(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '🔥', '✅', '😄', '🤔', '👀', '🙏', '❤️')),
  created_at timestamptz not null default now(),
  -- One person, one of each emoji, per comment. Pressing it again removes
  -- the row rather than adding a second.
  unique (comment_id, actor_assignee_id, emoji)
);

create or replace function public.set_reaction_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_owner uuid;
begin
  select user_id into parent_owner from public.item_comments where id = new.comment_id;
  if parent_owner is null then
    raise exception 'reaction references a comment that does not exist';
  end if;
  new.user_id = parent_owner;
  return new;
end;
$$;

drop trigger if exists comment_reactions_workspace on public.comment_reactions;
create trigger comment_reactions_workspace before insert on public.comment_reactions
  for each row execute function public.set_reaction_workspace();

-- ------------------------------------------------------------------- RLS

alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.task_participants enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.idea_recipients enable row level security;
alter table public.item_comments enable row level security;
alter table public.comment_reactions enable row level security;

-- Members: the owner runs the list; a manager may read the workspace he is
-- in (he has to be able to see who else is on a task) and nothing else.
drop policy if exists "workspace_members_owner_all" on public.workspace_members;
create policy "workspace_members_owner_all" on public.workspace_members
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "workspace_members_read_own_workspace" on public.workspace_members;
create policy "workspace_members_read_own_workspace" on public.workspace_members
  for select using (owner_id = public.workspace_of(auth.uid()));

-- Invites are the owner's alone. Redeeming one happens server-side with the
-- service-role key: the person accepting is, by definition, not yet a member
-- of anything and so can match no policy here.
drop policy if exists "workspace_invites_owner_all" on public.workspace_invites;
create policy "workspace_invites_owner_all" on public.workspace_invites
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- A2/A3: the owner sees his whole workspace; a manager sees an item only if
-- he set it or is on it. These four expressions are the entire visibility
-- model, and they are written inline rather than wrapped in a function
-- because a function that reads `tasks` inside the policy ON `tasks`
-- recurses.
drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_visible" on public.tasks for select using (
  user_id = auth.uid()
  or (
    user_id = public.workspace_of(auth.uid())
    and (
      created_by = auth.uid()
      or exists (
        select 1 from public.task_participants p
         where p.task_id = tasks.id
           and p.assignee_id = public.my_assignee(tasks.user_id)
      )
    )
  )
);

-- A manager may set a task on anyone — including on Кирилл — but it lands in
-- the owner's workspace, never in a private one of his own.
drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert" on public.tasks for insert with check (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

-- Being an executor grants no right to edit the task itself: a deadline is
-- moved by the person who set it, and progress is reported into
-- task_participants. That is B6 enforced by the database rather than by the
-- interface being careful.
drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update" on public.tasks for update using (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
) with check (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_delete" on public.tasks for delete using (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

drop policy if exists "meetings_select_own" on public.meetings;
create policy "meetings_visible" on public.meetings for select using (
  user_id = auth.uid()
  or (
    user_id = public.workspace_of(auth.uid())
    and (
      created_by = auth.uid()
      or exists (
        select 1 from public.meeting_participants p
         where p.meeting_id = meetings.id
           and p.assignee_id = public.my_assignee(meetings.user_id)
      )
    )
  )
);

drop policy if exists "meetings_insert_own" on public.meetings;
create policy "meetings_insert" on public.meetings for insert with check (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

drop policy if exists "meetings_update_own" on public.meetings;
create policy "meetings_update" on public.meetings for update using (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
) with check (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

drop policy if exists "meetings_delete_own" on public.meetings;
create policy "meetings_delete" on public.meetings for delete using (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

-- A thought is private unless it was sent to you.
drop policy if exists "ideas_select_own" on public.ideas;
create policy "ideas_visible" on public.ideas for select using (
  user_id = auth.uid()
  or (
    user_id = public.workspace_of(auth.uid())
    and (
      created_by = auth.uid()
      or exists (
        select 1 from public.idea_recipients r
         where r.idea_id = ideas.id
           and r.assignee_id = public.my_assignee(ideas.user_id)
      )
    )
  )
);

drop policy if exists "ideas_insert_own" on public.ideas;
create policy "ideas_insert" on public.ideas for insert with check (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

drop policy if exists "ideas_update_own" on public.ideas;
create policy "ideas_update" on public.ideas for update using (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
) with check (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

drop policy if exists "ideas_delete_own" on public.ideas;
create policy "ideas_delete" on public.ideas for delete using (
  user_id = auth.uid()
  or (user_id = public.workspace_of(auth.uid()) and created_by = auth.uid())
);

-- The list of people is shared: a manager has to be able to read the names
-- of everyone he is on a task with, and to pick from them when he sets a
-- task himself. Editing that list stays with the owner.
drop policy if exists "assignees_select_own" on public.assignees;
create policy "assignees_visible" on public.assignees for select using (
  user_id = auth.uid() or user_id = public.workspace_of(auth.uid())
);

-- Participants follow the item: if you can see the task, you can see who
-- else is on it. Writing is narrower — you may only move your own row, and
-- only through the columns that are yours to move (which columns those are
-- is enforced by the server routes; RLS can gate the row, not the field).
drop policy if exists "task_participants_visible" on public.task_participants;
create policy "task_participants_visible" on public.task_participants for select using (
  user_id = auth.uid()
  or (
    user_id = public.workspace_of(auth.uid())
    and exists (
      select 1 from public.task_participants mine
       where mine.task_id = task_participants.task_id
         and mine.assignee_id = public.my_assignee(task_participants.user_id)
    )
  )
);

drop policy if exists "task_participants_owner_write" on public.task_participants;
create policy "task_participants_owner_write" on public.task_participants for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Reporting on yourself: accepted / done / declined / asked for a new date.
drop policy if exists "task_participants_report_self" on public.task_participants;
create policy "task_participants_report_self" on public.task_participants for update
  using (
    user_id = public.workspace_of(auth.uid())
    and assignee_id = public.my_assignee(user_id)
  )
  with check (
    user_id = public.workspace_of(auth.uid())
    and assignee_id = public.my_assignee(user_id)
  );

drop policy if exists "meeting_participants_visible" on public.meeting_participants;
create policy "meeting_participants_visible" on public.meeting_participants for select using (
  user_id = auth.uid()
  or (
    user_id = public.workspace_of(auth.uid())
    and exists (
      select 1 from public.meeting_participants mine
       where mine.meeting_id = meeting_participants.meeting_id
         and mine.assignee_id = public.my_assignee(meeting_participants.user_id)
    )
  )
);

drop policy if exists "meeting_participants_owner_write" on public.meeting_participants;
create policy "meeting_participants_owner_write" on public.meeting_participants for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- C1: voting is answering about yourself, and it stays open until the
-- meeting starts (the route checks the clock; the policy checks the person).
drop policy if exists "meeting_participants_vote_self" on public.meeting_participants;
create policy "meeting_participants_vote_self" on public.meeting_participants for update
  using (
    user_id = public.workspace_of(auth.uid())
    and assignee_id = public.my_assignee(user_id)
  )
  with check (
    user_id = public.workspace_of(auth.uid())
    and assignee_id = public.my_assignee(user_id)
  );

drop policy if exists "idea_recipients_visible" on public.idea_recipients;
create policy "idea_recipients_visible" on public.idea_recipients for select using (
  user_id = auth.uid()
  or (
    user_id = public.workspace_of(auth.uid())
    and assignee_id = public.my_assignee(user_id)
  )
);

drop policy if exists "idea_recipients_owner_write" on public.idea_recipients;
create policy "idea_recipients_owner_write" on public.idea_recipients for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "idea_recipients_mark_self" on public.idea_recipients;
create policy "idea_recipients_mark_self" on public.idea_recipients for update
  using (
    user_id = public.workspace_of(auth.uid())
    and assignee_id = public.my_assignee(user_id)
  )
  with check (
    user_id = public.workspace_of(auth.uid())
    and assignee_id = public.my_assignee(user_id)
  );

-- D1: everyone on the item reads the whole conversation — no private
-- branches. Simpler to reason about, and a thread nobody can quietly split
-- is the point of having it inside the task.
drop policy if exists "item_comments_visible" on public.item_comments;
create policy "item_comments_visible" on public.item_comments for select using (
  user_id = auth.uid()
  or (
    user_id = public.workspace_of(auth.uid())
    and (
      (item_kind = 'task' and exists (
        select 1 from public.task_participants p
         where p.task_id = item_comments.item_id
           and p.assignee_id = public.my_assignee(item_comments.user_id)))
      or (item_kind = 'meeting' and exists (
        select 1 from public.meeting_participants p
         where p.meeting_id = item_comments.item_id
           and p.assignee_id = public.my_assignee(item_comments.user_id)))
      or (item_kind = 'idea' and exists (
        select 1 from public.idea_recipients r
         where r.idea_id = item_comments.item_id
           and r.assignee_id = public.my_assignee(item_comments.user_id)))
    )
  )
);

drop policy if exists "item_comments_write" on public.item_comments;
create policy "item_comments_write" on public.item_comments for insert with check (
  (user_id = auth.uid() and author_user_id = auth.uid())
  or (
    user_id = public.workspace_of(auth.uid())
    and author_user_id = auth.uid()
    and author_assignee_id = public.my_assignee(user_id)
  )
);

-- Editing and deleting your own words only, and deleting is soft — a
-- conversation that can be silently rewritten afterwards is no record.
drop policy if exists "item_comments_edit_own" on public.item_comments;
create policy "item_comments_edit_own" on public.item_comments for update
  using (author_user_id = auth.uid())
  with check (author_user_id = auth.uid());

drop policy if exists "comment_reactions_visible" on public.comment_reactions;
create policy "comment_reactions_visible" on public.comment_reactions for select using (
  user_id = auth.uid() or user_id = public.workspace_of(auth.uid())
);

drop policy if exists "comment_reactions_own" on public.comment_reactions;
create policy "comment_reactions_own" on public.comment_reactions for all
  using (actor_user_id = auth.uid() or user_id = auth.uid())
  with check (actor_user_id = auth.uid() or user_id = auth.uid());

-- ------------------------------------------------------------- realtime

-- Same as every other table the UI watches: a colleague pressing a button in
-- Telegram has to move the card on the screen without a reload.
alter publication supabase_realtime add table public.task_participants;
alter publication supabase_realtime add table public.meeting_participants;
alter publication supabase_realtime add table public.idea_recipients;
alter publication supabase_realtime add table public.item_comments;
alter publication supabase_realtime add table public.comment_reactions;
alter publication supabase_realtime add table public.workspace_members;
