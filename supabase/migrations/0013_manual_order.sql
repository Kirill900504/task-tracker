-- Free manual drag-to-reorder within a task column, on top of the existing
-- automatic urgency sort. NULL (the default) means "not manually placed
-- yet" — those tasks keep sorting by the existing rules; once dragged, a
-- task gets an explicit position and manually-ordered tasks always sort
-- ahead of unordered ones.
alter table public.tasks add column manual_order integer;
