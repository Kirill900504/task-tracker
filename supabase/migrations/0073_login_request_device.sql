-- Which device is asking to sign in (30.10.2026, sign-in audit).
--
-- The "is this you?" question in the messenger used to say only "a new
-- device". The person who did NOT start the login had nothing to tell the
-- stranger's request from their own, and three number buttons under it
-- invite a curious tap — one in three of which hands the session over.
-- The login page now records the browser and system it runs on, and the
-- question names them together with the time.
alter table public.login_requests add column if not exists device text;
