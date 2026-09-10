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

-- Хранилище файлов Supabase. Здесь его нет, но миграция 0020 заводит в нём
-- корзину и права, а значит проверка должна уметь их применить. Стоят
-- ровно те три вещи, к которым обращается миграция: две таблицы и функция,
-- разбирающая путь на папки.
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

-- Настоящая возвращает список папок пути; для проверки прав нужен только
-- первый сегмент, но поведение то же.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/')
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
