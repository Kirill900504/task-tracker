-- Регулярные встречи: «каждую неделю», «раз в две недели», «каждый месяц».
--
-- 07.10.2026, п.7 предложений, «согласен». Планёрку по понедельникам
-- приходилось заводить заново каждую неделю — и в ту неделю, когда это
-- забывали, её не было ни у кого в календаре.
--
-- Каждое повторение — ОТДЕЛЬНАЯ встреча, а не одна строка с правилом:
-- у каждой свои голоса, свой итог, своё обсуждение и свой перенос. Правило
-- живёт на встрече (`recur`), а следующую заводит крон в день текущей
-- (lib/meetingRepeat), так что людям приходит обычное приглашение
-- примерно за период вперёд.
--
-- `recur_next_id` — какую встречу уже породила эта. Пустое — ещё не
-- порождала. Крон сперва занимает это поле условным UPDATE и только
-- потом вставляет следующую: два прогона крона в одну минуту иначе
-- завели бы две одинаковые планёрки. Колонку пишет только сервер, её нет
-- в meetingToRow.

alter table public.meetings add column if not exists recur text not null default 'none';
alter table public.meetings drop constraint if exists meetings_recur_check;
alter table public.meetings add constraint meetings_recur_check
  check (recur in ('none', 'weekly', 'biweekly', 'monthly'));
alter table public.meetings add column if not exists recur_next_id text;

create index if not exists meetings_recur_pending_idx
  on public.meetings (date)
  where recur <> 'none' and recur_next_id is null and deleted_at is null;
