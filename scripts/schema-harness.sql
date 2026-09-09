-- The parts of Supabase that a plain Postgres does not have.
--
-- Enough of them, and only them, for the migrations in supabase/migrations
-- to apply exactly as they do on the real database: the auth schema they
-- reference by foreign key, the auth.uid() that every row-level security
-- policy is written against, the three roles Supabase connects as, and the
-- publication the realtime feature subscribes to.
--
-- Used by scripts/test-schema.mjs. Nothing here ships anywhere.

create extension if not exists pgcrypto;

create schema if not exists auth;

-- Only the columns the migrations actually reference. The real table has
-- forty; borrowing all of them would mean keeping them in step for nothing.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

-- Supabase reads the signed-in user out of the request's JWT claims. The
-- setting below is the same one it uses, so a test "signs in" by setting it
-- and every policy behaves exactly as it does in production.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
