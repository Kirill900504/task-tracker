-- Login by a request pushed into the messenger (30.10.2026).
--
-- The login page can now ask the bot to send the "is this you?" question
-- straight into the person's chat, found by phone or email, instead of
-- making them open a link. Anyone can type someone else's phone, so the
-- question is answered by picking the number shown on the login screen
-- (number matching): a person who did not start the login cannot know it,
-- and a habitual "yes" no longer hands the session to a stranger.
alter table public.login_requests add column if not exists code smallint;
