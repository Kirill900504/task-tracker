-- Telegram: pending destructive-action confirmation (delete task/meeting).
-- Separate from pending_context (clarify-flow state) so the two flows never
-- interfere with each other.
alter table public.telegram_accounts
  add column if not exists pending_action jsonb;
