-- Bug fix: the app generates its own short ids client-side (e.g. "tmsmwo7clh8xjy"),
-- not real UUIDs, but tasks/meetings/ideas.id was declared as `uuid`. Every insert
-- would have failed. Assignees are unaffected — the app never references their id.

alter table public.tasks alter column id drop default;
alter table public.tasks alter column id type text using id::text;

alter table public.meetings alter column id drop default;
alter table public.meetings alter column id type text using id::text;

alter table public.ideas alter column id drop default;
alter table public.ideas alter column id type text using id::text;
