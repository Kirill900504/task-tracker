-- Память бота: о чём только что говорили, и чему он научился.
--
-- 19.10.2026 Кирилл попросил бота перенести одну встречу и за шесть минут
-- написал семь сообщений: «Перенеси эту встречу на следующий понедельник»,
-- «Только телемост», «Только телемост перенеси», «На 26.10», «26.10»… Каждое
-- бот разбирал как первое в жизни: «Только телемост» не знало, что выше
-- был список из трёх записей, а «26.10» — что речь о переносе. Его слова
-- 20.10.2026: «улучши механизм работы и его обучаемость».
--
-- 1. bot_dialog — последние реплики разговора в одном чате. Модель видит
-- их вместе с новым сообщением и понимает уточнение как уточнение. Живёт
-- коротко: читаются реплики за последние полчаса, старше суток не нужны
-- никому (уборка — в кроне напоминаний).
--
-- 2. bot_lessons — фраза человека и разбор, который он ПОДТВЕРДИЛ («да» или
-- кнопкой). Похожие уроки подкладываются модели примерами: как этот
-- человек говорит «перенеси» и что он при этом имеет в виду. Урок
-- принадлежит тому, кто его дал (`actor`), а не пространству: фраза одного
-- человека — его данные, и в подсказку другому она не попадает (правило
-- «каждый видит только своё», миграция 0057).
--
-- Политик нет НАМЕРЕННО — как у bot_messages и notification_queue: пишут и
-- читают только маршруты бота служебным ключом. Браузеру это не нужно.

create table if not exists public.bot_dialog (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'max')),
  chat_id bigint not null,
  role text not null check (role in ('user', 'bot')),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.bot_dialog enable row level security;

create index if not exists bot_dialog_chat_idx
  on public.bot_dialog (channel, chat_id, created_at desc);

create table if not exists public.bot_lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Чей урок: auth-id того, кто подтвердил, или id его строки людей, если
  -- входа у него нет. Текст, а не ссылка: это ключ, а не связь.
  actor text not null,
  phrase text not null,
  parsed jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.bot_lessons enable row level security;

create index if not exists bot_lessons_actor_idx
  on public.bot_lessons (actor, created_at desc);
