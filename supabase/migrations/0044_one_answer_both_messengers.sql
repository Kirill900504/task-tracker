-- Один ответ — во всех мессенджерах сразу, и предложение другого времени.
--
-- 1. Какие сообщения бот отправил человеку о задаче или встрече.
--
-- Отзыв Кирилла 07.10.2026: «на моём основном аккаунте я в телеге нажал
-- „буду участвовать“, а в моём МАХ ничего не изменилось», и обратно —
-- «не смогу» с причиной из MAX не появилось в Telegram. «Я хочу, чтобы
-- они работали абсолютно синхронно».
--
-- Владелец получает каждое приглашение в ОБА мессенджера (lib/reach), а
-- нажатие переписывало только то сообщение, под которым нажали: о втором
-- бот просто ничего не знал. Telegram и MAX правят сообщение по его id, и
-- id этот нигде не хранился. Теперь хранится — одна строка на каждое
-- отправленное сообщение о задаче или встрече, и после любого ответа
-- (кнопкой в любом мессенджере или в самом трекере) бот переписывает все
-- остальные под то, что действует сейчас (lib/botMirror).
--
-- Политик нет НАМЕРЕННО — как у notification_queue и client_errors: пишут
-- и читают только маршруты служебным ключом. Браузеру id чужих сообщений
-- в мессенджере не нужны ни для чего.
create table if not exists public.bot_messages (
  id uuid primary key default gen_random_uuid(),
  -- Пространство. default auth.uid() — по правилу проекта, хотя вставляет
  -- сюда только служебный ключ и передаёт его явно.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  assignee_id uuid not null references public.assignees(id) on delete cascade,
  item_kind text not null check (item_kind in ('task', 'meeting')),
  item_id text not null,
  channel text not null check (channel in ('telegram', 'max')),
  chat_id bigint not null,
  message_id text not null,
  created_at timestamptz not null default now()
);

alter table public.bot_messages enable row level security;

create index if not exists bot_messages_item_idx
  on public.bot_messages (item_kind, item_id, assignee_id);

-- Сообщение старше месяца не переписывается: оно давно уехало вверх, а
-- Telegram и вовсе не даёт править сообщения старше двух суток у ботов в
-- части случаев. Индекс по времени — для уборки, если она понадобится.
create index if not exists bot_messages_created_idx
  on public.bot_messages (created_at);

-- 2. Предложение другого времени встречи.
--
-- Отзыв Кирилла 07.10.2026: «добавь возможность запросить перенос у
-- приглашённых участников встречи… один из четырёх участников
-- запрашивает другое время, остальные ставят реакцию, приемлемо ли для
-- них новое время».
--
-- Это реплика в обсуждении встречи — с автором, временем, реакциями и
-- доставкой в мессенджер, всем тем, что у обсуждения уже есть. Не новая
-- таблица: голос «подходит / не подходит» — это реакция 👍 / 👎 на эту
-- реплику, и третья правда о том же («кто согласен») разошлась бы с
-- реакциями. Колонка несёт только то, что машине нужно прочесть
-- точно, — дату и время, — чтобы организатор переносил одним нажатием,
-- а не перепечатывал число из чужого текста.
alter table public.item_comments
  add column if not exists proposal jsonb;

comment on column public.item_comments.proposal is
  'Предложение перенести встречу: {"date":"YYYY-MM-DD","time":"HH:MM"}. NULL — обычная реплика.';
