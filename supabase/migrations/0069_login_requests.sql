-- Вход на компьютере через мессенджер, без пароля (lib/messengerLogin).
--
-- Страница входа заводит запрос со случайным токеном и даёт ссылку на бота
-- с этим токеном; человек нажимает в боте «Да, это я», и бот кладёт сюда
-- одноразовый код входа (hashed_token magiclink). Страница, которая ждёт
-- ответа, забирает код ОДИН раз и меняет его на сессию — в том же окне,
-- то есть и в настольном приложении, где ссылку из чата открыть некуда.
--
-- Политик нет вовсе: читает и пишет только сервер служебным ключом. Строка
-- живёт десять минут, после выдачи кода удаляется.

create table if not exists public.login_requests (
  token text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  -- Кто подтвердил в мессенджере и каким кодом войти. Пусто — ещё ждём.
  approved_at timestamptz,
  token_hash text,
  -- Отказ из бота («Нет, это не я»): страница перестаёт ждать.
  refused_at timestamptz
);

alter table public.login_requests enable row level security;
revoke all on public.login_requests from anon, authenticated;
