-- Ответ на конкретное сообщение и цитата — это одно и то же в переписке
-- (Telegram и MAX показывают ровно так, как просил Кирилл 23.09.2026):
-- нажали «Ответить» на чужой или своей реплике, и новое сообщение несёт
-- ссылку на неё, а лента рисует сверху цитату — автора и обрывок текста.
--
-- on delete set null, а не cascade: убранное позже цитируемое сообщение не
-- должно тащить за собой ответ на него — тот же принцип, что у мягкого
-- удаления реплик (item_comments.deleted_at), только для внешнего ключа.
alter table public.item_comments
  add column if not exists reply_to uuid references public.item_comments(id) on delete set null;

comment on column public.item_comments.reply_to is
  'Сообщение, на которое отвечают/которое цитируют. NULL — обычное сообщение.';

create index if not exists item_comments_reply_to_idx on public.item_comments (reply_to);

-- Набор реакций расширен — тот же принцип («фиксированный набор, а не
-- открытый список», см. миграцию 0019): любой эмодзи здесь должен
-- пережить дорогу в Telegram и MAX, где реакция — обычная строка текста
-- под сообщением, а не картинка. Прежние восемь остаются все до одного —
-- список только растёт, иначе у кого-то уже стоящая реакция стала бы
-- невозможной задним числом.
alter table public.comment_reactions drop constraint if exists comment_reactions_emoji_check;
alter table public.comment_reactions add constraint comment_reactions_emoji_check
  check (emoji in (
    '👍', '🔥', '✅', '😄', '🤔', '👀', '🙏', '❤️',
    '👎', '😂', '😮', '😢', '😡', '🎉', '👏', '💪', '💯'
  ));
