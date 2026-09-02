-- Enable Realtime so a change made in one tab/device shows up live in
-- another, without a manual refresh.
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.meetings;
alter publication supabase_realtime add table public.ideas;
alter publication supabase_realtime add table public.assignees;

-- assignees are stored in-memory as a flat list of names (no ids), so a
-- DELETE event needs the deleted row's name, not just its id — the default
-- replica identity only sends the primary key for deletes.
alter table public.assignees replica identity full;
