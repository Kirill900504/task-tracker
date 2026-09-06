-- Sending tasks, meetings and thoughts to colleagues in Telegram.
--
-- A colleague is not a user of the tracker: they never sign in and own
-- nothing. They are an existing row in `assignees` that has been connected
-- to a Telegram chat, so the bot can write to them and they can answer with
-- a button. Everything they can do is scoped to items addressed to them.

alter table public.assignees
  add column if not exists telegram_chat_id bigint,
  add column if not exists telegram_username text,
  add column if not exists linked_at timestamptz;

-- One chat per person per owner: given a chat, the webhook has to know
-- unambiguously whose colleague is writing.
create unique index if not exists assignees_owner_chat_idx
  on public.assignees (user_id, telegram_chat_id)
  where telegram_chat_id is not null;

-- An invite code carries the colleague it is for. Without it (the original
-- shape) the code links the OWNER's own account, exactly as before.
alter table public.telegram_link_codes
  add column if not exists assignee_id uuid references public.assignees(id) on delete cascade;

-- "Принял" is not a status of its own: the task stays in work, it just
-- carries the moment the person picked it up.
alter table public.tasks
  add column if not exists accepted_at timestamptz,
  add column if not exists sent_at timestamptz;

alter table public.meetings
  add column if not exists sent_at timestamptz,
  -- Who said they will come, by the same names the participants list uses.
  add column if not exists confirmed_by text[] not null default '{}';

alter table public.ideas
  add column if not exists sent_at timestamptz;
