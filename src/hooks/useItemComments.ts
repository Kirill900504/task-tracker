"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { onRevive } from "@/lib/revive";
import { me } from "@/lib/me";
import { withoutSelfMark } from "@/lib/actorName";
import { describeDbError } from "@/lib/syncError";

// Обсуждение внутри задачи или встречи.
//
// Its absence is why every discussion about a task happens somewhere else —
// in WhatsApp, in a corridor, in a voice message — and why a task in the
// tracker so often says less than the people working on it know. One table
// for all three kinds of item, because the conversation is identical on a
// task, a meeting and a thought, and three near-copies drift apart.
//
// Loaded per item rather than all at once: a conversation is only ever read
// with the thing it is about open in front of you.

export type ItemKind = "task" | "meeting" | "idea";

// Закрытая корзина: у файла нет постоянного адреса, только подписанная
// ссылка на час. Иначе ссылка, пересланная наружу, работала бы вечно.
export const BUCKET = "item-files";

// Расширен 23.09.2026 с восьми до семнадцати — прежние остаются, только
// добор. Список фиксирован (не открытый пикер) по причине из 2019-й
// миграции: реакция уезжает в Telegram и MAX обычной строкой текста, а не
// картинкой, и произвольный эмодзи там превращается в квадрат. Ограничение
// в базе — check на comment_reactions.emoji (миграция 0040) — держит тот
// же список.
export const REACTIONS = [
  "👍", "🔥", "✅", "😄", "🤔", "👀", "🙏", "❤️",
  "👎", "😂", "😮", "😢", "😡", "🎉", "👏", "💪", "💯",
] as const;
export type Reaction = (typeof REACTIONS)[number];

export type Attachment = {
  path: string;
  name: string;
  size: number;
  type: string;
  // Ссылка живёт час и запрашивается заново при каждой загрузке списка:
  // корзина закрытая, и постоянной ссылки у файла нет по замыслу.
  url?: string;
};

export type Comment = {
  id: string;
  body: string;
  attachments: Attachment[];
  createdAt: string;
  editedAt: string | null;
  authorName: string;
  mine: boolean;
  source: "app" | "telegram" | "max";
  // Запись хроники, а не реплика: её не правят, на неё не ставят реакции и
  // выглядит она строкой, а не сообщением (миграция 0026).
  system: boolean;
  // Эмодзи → кто его поставил (именами, чтобы можно было показать в
  // подсказке), плюс отметка «я среди них».
  reactions: { emoji: string; count: number; mine: boolean }[];
  // Написано, показано, но ещё не подтверждено базой. Такое сообщение живёт
  // только в этой вкладке: его нельзя ни править, ни убрать — у него ещё нет
  // адреса, по которому это делают.
  sending?: boolean;
  // Сообщение, на которое отвечают/которое цитируют — то же самое действие
  // под двумя именами (см. миграцию 0040). Пусто, если это обычная реплика.
  // Убранное позже цитируемое сообщение оставляет здесь null, а не рвёт
  // это: сама цитата всё равно уже сказана.
  replyTo?: { id: string; body: string; authorName: string } | null;
};

type ReplyRow = {
  id: string;
  body: string;
  author_user_id: string | null;
  assignees: { name: string } | { name: string }[] | null;
};

type CommentRow = {
  id: string;
  body: string;
  attachments: Attachment[] | null;
  created_at: string;
  edited_at: string | null;
  source: "app" | "telegram" | "max";
  system: boolean;
  author_user_id: string | null;
  author_assignee_id: string | null;
  assignees: { name: string } | { name: string }[] | null;
  reply_to: string | null;
  // Самоссылка через PostgREST: embed по имени колонки-внешнего ключа
  // (`reply:reply_to(...)`), а не по имени таблицы — только так embed
  // идёт «вперёд», к тому сообщению, НА КОТОРОЕ отвечают, а не «назад», к
  // тем, что отвечают на это. Проверено вручную против боевой базы
  // 23.09.2026: `item_comments!reply_to(...)` даёт ровно обратное.
  reply?: ReplyRow | null;
};

type ReactionRow = {
  id: string;
  comment_id: string;
  emoji: string;
  actor_user_id: string | null;
};

function nameOf(row: Pick<CommentRow, "author_user_id" | "assignees">, meId: string, ownerLabel: string): string {
  if (row.author_user_id && row.author_user_id === meId) return "Вы";
  const a = row.assignees;
  const name = Array.isArray(a) ? a[0]?.name : a?.name;
  // «(я)» — пометка для того, кто ищет себя в списке людей. В подписи под
  // чужой репликой её читает кто угодно, кроме него.
  return withoutSelfMark(name || "") || ownerLabel;
}

// Сообщение, которое уже на экране, но ещё не в базе. Пока серверная строка
// не приехала, показывается местная копия; как только приехала — местная
// исчезает, и подмены не видно, потому что текст один и тот же.
type Outgoing = { local: Comment; serverId: string | null };

// Реакция ставится на экран до того, как о ней узнает база: нажатие — уже
// ответ, и полсекунды неизменившейся кнопки читаются как «не сработало».
function toggleReaction(list: Comment["reactions"], emoji: string, on: boolean): Comment["reactions"] {
  const current = list.find((r) => r.emoji === emoji);
  if (on) {
    if (!current) return [...list, { emoji, count: 1, mine: true }];
    return list.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r));
  }
  if (!current) return list;
  if (current.count <= 1) return list.filter((r) => r.emoji !== emoji);
  return list.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r));
}

export function useItemComments(kind: ItemKind, itemId: string) {
  const [comments, setComments] = useState<Comment[]>([]);
  // Отдельным списком, а не вперемешку с пришедшими: лента перечитывается
  // целиком на каждое движение в базе — в том числе на чужое сообщение,
  // пришедшее ровно тогда, когда отправляется своё. Своё, лежи оно в общем
  // списке, такой перечиткой стёрло бы.
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async (): Promise<Comment[]> => {
    if (!itemId) return [];
    const db = createClient();
    const { userId: meId } = await me();

    const [{ data: rows }, { data: reactions }] = await Promise.all([
      db
        .from("item_comments")
        .select(
          "id, body, attachments, created_at, edited_at, source, system, author_user_id, author_assignee_id, reply_to, assignees(name), " +
            "reply:reply_to(id, body, author_user_id, assignees(name))",
        )
        .eq("item_kind", kind)
        .eq("item_id", itemId)
        .is("deleted_at", null)
        .order("created_at"),
      db.from("comment_reactions").select("id, comment_id, emoji, actor_user_id"),
    ]);

    const byComment = new Map<string, ReactionRow[]>();
    for (const r of ((reactions || []) as ReactionRow[])) {
      const list = byComment.get(r.comment_id);
      if (list) list.push(r);
      else byComment.set(r.comment_id, [r]);
    }

    // Подписанные ссылки — одной пачкой на весь список: по одной на файл
    // это десяток запросов на открытие карточки.
    const allPaths = ((rows || []) as unknown as CommentRow[]).flatMap((r) => (r.attachments || []).map((a) => a.path));
    const urlByPath = new Map<string, string>();
    if (allPaths.length) {
      const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(allPaths, 3600);
      for (const item of signed || []) {
        if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
      }
    }

    return ((rows || []) as unknown as CommentRow[]).map((row) => {
      const mine = !!row.author_user_id && row.author_user_id === meId;
      const grouped = new Map<string, { count: number; mine: boolean }>();
      for (const r of byComment.get(row.id) || []) {
        const cur = grouped.get(r.emoji) || { count: 0, mine: false };
        grouped.set(r.emoji, { count: cur.count + 1, mine: cur.mine || r.actor_user_id === meId });
      }
      const replyRow = row.reply;
      return {
        id: row.id,
        body: row.body,
        attachments: (row.attachments || []).map((a) => ({ ...a, url: urlByPath.get(a.path) })),
        createdAt: row.created_at,
        editedAt: row.edited_at,
        authorName: nameOf(row, meId, "Кирилл"),
        mine,
        source: row.source,
        system: !!row.system,
        reactions: [...grouped.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
        // reply_to стоит, а сама реплика уже убрана (мягко) — embed вернёт
        // null, и цитата в ленте не покажется вовсе: то же самое, что
        // отсутствие reply_to с точки зрения того, кто читает.
        replyTo: replyRow ? { id: replyRow.id, body: replyRow.body, authorName: nameOf(replyRow, meId, "Кирилл") } : null,
      };
    });
  }, [kind, itemId]);

  useEffect(() => {
    let cancelled = false;
    function pull() {
      fetchAll().then((list) => {
        if (cancelled) return;
        setComments(list);
        setLoading(false);
      });
    }
    pull();

    const db = createClient();
    const channel = db
      .channel(`comments-${kind}-${itemId}`)
      // Фильтр по своей задаче — не украшение: без него каждое сообщение в
      // ЛЮБОМ обсуждении трекера заставляло открытую карточку перечитывать
      // всю свою ленту вместе с подписанными ссылками на файлы.
      .on("postgres_changes", { event: "*", schema: "public", table: "item_comments", filter: `item_id=eq.${itemId}` }, () => {
        fetchAll().then((list) => {
          if (!cancelled) setComments(list);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "comment_reactions" }, () => {
        fetchAll().then((list) => {
          if (!cancelled) setComments(list);
        });
      })
      // Каждый подъём канала — повод перечитать: пока он поднимался,
      // события не приходили, а догонять пропущенное realtime не умеет.
      .subscribe((status) => {
        if (status === "SUBSCRIBED") pull();
      });

    // И те же поводы, что у всего остального (см. lib/revive.ts). Здесь это
    // заметнее всего: обсуждение — это переписка, и реплика, пришедшая в
    // открытую карточку, не должна ждать перезагрузки. Реже, чем у доски:
    // лента тянет за собой подписанные ссылки на файлы.
    const stopRevive = onRevive(pull, { everyMs: 120_000 });

    return () => {
      cancelled = true;
      stopRevive();
      void db.removeChannel(channel);
    };
  }, [fetchAll, kind, itemId]);

  const reload = useCallback(async () => setComments(await fetchAll()), [fetchAll]);

  // Дорога сообщения в облако: файлы в корзину, строка в таблицу, рассылка
  // остальным. Всё это происходит уже ПОСЛЕ того, как человек увидел свой
  // текст в ленте, — см. `send` ниже.
  const sendToCloud = useCallback(
    async (text: string, files: File[], localId: string, replyToId: string | null) => {
      const db = createClient();
      const { userId, assigneeId, workspaceId } = await me();
      // Путь начинается с пространства: по первому сегменту права и
      // решают, чей это файл (см. миграцию 0020). Владелец пишет в своё,
      // руководитель — в то, куда принят.
      //
      // owner_id здесь не запрашивался, и подстановка молча сваливалась на
      // собственный id: файл руководителя уезжал в папку, которой по
      // правилам корзины не существует. Ошибка была видна только тому, кто
      // пробовал приложить фотографию с чужого входа.
      const workspace = workspaceId;
      const attachments: Attachment[] = [];
      for (const file of files) {
        const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
        const path = `${workspace}/${kind}/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
        const { error: upErr } = await db.storage.from(BUCKET).upload(path, file, { upsert: false });
        if (upErr) throw new Error(`Не загрузился файл «${file.name}»: ${upErr.message}`);
        attachments.push({ path, name: file.name, size: file.size, type: file.type });
      }

      const row = {
        item_kind: kind,
        item_id: itemId,
        body: text,
        attachments,
        // Оба поля пишутся сразу: у вошедшего в трекер есть и логин, и строка
        // в списке людей, а имя потом нужно показать независимо от того,
        // через какую дверь сообщение пришло.
        author_user_id: userId || null,
        author_assignee_id: assigneeId,
        source: "app",
        // Ссылка на местное сообщение (id вида "local-…") сюда попасть не
        // может: цитировать можно только то, что уже приехало из базы, —
        // composer не даёт выбрать сообщение, ещё не подтверждённое.
        reply_to: replyToId,
      };
      // id возвращается ради рассылки: сказать остальным участникам — часть
      // отправки, а не побочное дело. Раньше сообщение просто ложилось в
      // базу, и тот, кому оно написано, не узнавал о нём никогда.
      let { data: saved, error } = await db.from("item_comments").insert(row).select("id").maybeSingle();

      // «comment references an item that does not exist» — это не поломка, а
      // гонка, и до сих пор она вылезала на экран как есть: по-английски и
      // словами про строки базы. Задача, написанная минуту назад, живёт
      // сперва в браузере и уезжает в облако своим ходом (см. useTrackerData),
      // а обсуждение ссылается на неё внешним ключом — пока строки нет,
      // триггер отказывает. Правильный ответ здесь — не сообщение об ошибке,
      // а подождать задачу и отправить ещё раз; человеку об этом знать
      // незачем.
      if (error && /does not exist/i.test(error.message)) {
        const table = kind === "task" ? "tasks" : kind === "meeting" ? "meetings" : "ideas";
        for (let i = 0; i < 12; i++) {
          const { data: parent } = await db.from(table).select("id").eq("id", itemId).maybeSingle();
          if (parent) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        ({ data: saved, error } = await db.from("item_comments").insert(row).select("id").maybeSingle());
        if (error && /does not exist/i.test(error.message)) {
          throw new Error("Задача ещё не сохранилась в облаке — проверьте связь и отправьте сообщение ещё раз.");
        }
      }
      // Сообщение, которое не сохранилось, не должно исчезнуть молча: чаще
      // всего это задача, ещё не доехавшая до облака, и человеку надо дать
      // повторить, а не гадать, куда делся его текст. Бросаем здесь, до
      // рассылки: рассылать нечего.
      //
      // «new row violates row-level security policy…» уходило на экран как
      // есть — то есть именем таблицы и по-английски, ни слова о том, что
      // делать. Это тот самый отказ, который до 23.09.2026 чинился в
      // lib/me.ts (устаревший кэш членства); текст здесь — второй слой на
      // случай, если причина окажется другой.
      if (error) {
        if (/row-level security/i.test(error.message)) {
          throw new Error(
            "Нет прав написать сюда — похоже, доступ к пространству обновился, а эта вкладка ещё не узнала об этом. Обновите страницу и попробуйте снова.",
          );
        }
        throw new Error(describeDbError(error));
      }

      // Рассылка — отдельным вызовом и молча: сообщение уже сохранено, и
      // уронить отправку из-за того, что не ушло уведомление, было бы
      // обменом наоборот. Не дошло — о сообщении скажет утренняя сводка.
      //
      // И её НЕ ЖДУТ: это ещё одна очередь в сеть, а на экране всё уже
      // случилось. Раньше ожидание здесь стоило человеку той же секунды,
      // ради которой всё это и переписано.
      const savedId = (saved as { id: string } | null)?.id;
      if (savedId) {
        void fetch("/api/workspace/comment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentId: savedId }),
        }).catch(() => {
          // Связь. Сводка догонит.
        });
      }

      // Серверная строка приехала — местную копию можно убирать, но только
      // если в перечитанной ленте она действительно есть. Иначе (реплика
      // отстала) копия остаётся и исчезнет сама, когда её id появится в
      // ленте: пропасть и появиться заново сообщение не должно.
      const fresh = await fetchAll();
      setComments(fresh);
      setOutbox((prev) =>
        savedId && fresh.some((c) => c.id === savedId)
          ? prev.filter((o) => o.local.id !== localId)
          : prev.map((o) => (o.local.id === localId ? { ...o, serverId: savedId || null } : o)),
      );
    },
    [kind, itemId, fetchAll],
  );

  // Отправка начинается с экрана, а не с облака.
  //
  // Раньше она начиналась с облака: спросить, кто я (запрос в сеть), спросить
  // мою строку в списке людей (ещё запрос), вставить сообщение (третий),
  // дождаться рассылки (четвёртый) и перечитать ленту целиком (пятый, а с ним
  // ещё и подписанные ссылки на все файлы обсуждения). Только после этого
  // текст появлялся на экране. Вот эти пять очередей подряд и были «чат
  // отправляет с секундной задержкой»: ничего не тормозило, просто человеку
  // показывали результат последним.
  //
  // Теперь наоборот: сообщение появляется в ту же долю секунды, а сеть
  // догоняет. Кто я — уже известно (см. lib/me.ts), рассылки не ждём, лента
  // перечитывается потом и незаметно. Не ушло — местная копия исчезает,
  // текст возвращается в поле, и человек видит, почему.
  const send = useCallback(
    (body: string, files: File[] = [], replyTo: Comment | null = null): Promise<void> => {
      const text = body.trim();
      if ((!text && !files.length) || !itemId) return Promise.resolve();

      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const local: Comment = {
        id: localId,
        body: text,
        // Файл называется, но не показывается: он физически едет в корзину, и
        // нарисовать картинку раньше, чем она туда доехала, значит соврать.
        // Имя файла — правда, доступная сразу.
        attachments: files.map((f) => ({ path: `${localId}-${f.name}`, name: f.name, size: f.size, type: f.type })),
        createdAt: new Date().toISOString(),
        editedAt: null,
        authorName: "Вы",
        mine: true,
        source: "app",
        system: false,
        reactions: [],
        sending: true,
        // Цитата рисуется сразу же, из того, что уже на экране — ждать
        // ответа сервера ради нескольких слов чужой реплики незачем.
        replyTo: replyTo ? { id: replyTo.id, body: replyTo.body, authorName: replyTo.authorName } : null,
      };
      setOutbox((prev) => [...prev, { local, serverId: null }]);

      return sendToCloud(text, files, localId, replyTo?.id ?? null).catch((err) => {
        setOutbox((prev) => prev.filter((o) => o.local.id !== localId));
        throw err;
      });
    },
    [itemId, sendToCloud],
  );

  // Своё сообщение можно поправить или убрать; чужое — нет. Удаление мягкое:
  // переписку, которую можно незаметно переписать задним числом, незачем
  // было и заводить.
  //
  // Правка и удаление, как и отправка, показываются до того, как о них узнает
  // база: человек уже нажал «Сохранить», и лента, полсекунды показывающая
  // старый текст, читается как «не сохранилось». Перечитываем только если
  // запись не прошла — тогда экран возвращается к правде.
  const edit = useCallback(
    async (commentId: string, body: string) => {
      const text = body.trim();
      const editedAt = new Date().toISOString();
      setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, body: text, editedAt } : c)));
      const db = createClient();
      const { error } = await db.from("item_comments").update({ body: text, edited_at: editedAt }).eq("id", commentId);
      if (error) await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (commentId: string) => {
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      const db = createClient();
      const { error } = await db.from("item_comments").update({ deleted_at: new Date().toISOString() }).eq("id", commentId);
      if (error) await reload();
    },
    [reload],
  );

  // Нажатие на уже поставленную реакцию её снимает — иначе единственный
  // способ передумать это попросить кого-то другого.
  const react = useCallback(
    async (commentId: string, emoji: string, on: boolean) => {
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, reactions: toggleReaction(c.reactions, emoji, on) } : c)),
      );
      const db = createClient();
      const { userId: meId, assigneeId } = await me();
      const { error } = !on
        ? await db.from("comment_reactions").delete().eq("comment_id", commentId).eq("emoji", emoji).eq("actor_user_id", meId)
        : await db.from("comment_reactions").insert({
            comment_id: commentId,
            emoji,
            actor_user_id: meId,
            actor_assignee_id: assigneeId,
          });
      if (error) await reload();
    },
    [reload],
  );

  // Лента — это пришедшее из базы плюс то, что ещё едет, и оба источника
  // сортируются ВМЕСТЕ по времени, а не «сперва база, потом хвостом то, что
  // едет». До 23.09.2026 местные сообщения просто дописывались в конец —
  // обычно они и правда самые свежие, но не всегда: реплика коллеги может
  // прийти realtime'ом секундой позже своего реального времени (её
  // отправили раньше, чем эта вкладка о ней узнала), а системная строка
  // события пишется сервером и может обогнать ещё не подтверждённое
  // локальное сообщение. Слова Кирилла 23.09.2026: «переписка и события
  // или смены статусов с комментариями должны идти в хронологическом
  // порядке во всех чатах всех событий» — и это касается не только задач,
  // но и встреч, и мыслей, потому что все три ходят через этот же хук.
  //
  // Подмены при этом всё равно не видно: местная копия исчезает ровно
  // тогда, когда её серверная строка появляется в ленте, а текст на экране
  // не меняется.
  const visible = useMemo(() => {
    if (!outbox.length) return comments;
    const arrived = new Set(comments.map((c) => c.id));
    const waiting = outbox.filter((o) => !(o.serverId && arrived.has(o.serverId)));
    if (!waiting.length) return comments;
    // ISO-строки сравниваются как текст — они устроены так, что лексический
    // порядок совпадает с временным. Сортировка стабильна в V8 (и того же
    // требует спецификация ES2019+), так что сообщения одной секунды не
    // перемешиваются между собой.
    return [...comments, ...waiting.map((o) => o.local)].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }, [comments, outbox]);

  return { comments: visible, loading, send, edit, remove, react };
}
