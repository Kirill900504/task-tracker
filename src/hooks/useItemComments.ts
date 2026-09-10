"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

export const REACTIONS = ["👍", "🔥", "✅", "😄", "🤔", "👀", "🙏", "❤️"] as const;
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
  // Эмодзи → кто его поставил (именами, чтобы можно было показать в
  // подсказке), плюс отметка «я среди них».
  reactions: { emoji: string; count: number; mine: boolean }[];
};

type CommentRow = {
  id: string;
  body: string;
  attachments: Attachment[] | null;
  created_at: string;
  edited_at: string | null;
  source: "app" | "telegram" | "max";
  author_user_id: string | null;
  author_assignee_id: string | null;
  assignees: { name: string } | { name: string }[] | null;
};

type ReactionRow = {
  id: string;
  comment_id: string;
  emoji: string;
  actor_user_id: string | null;
};

function nameOf(row: CommentRow, meId: string, ownerLabel: string): string {
  if (row.author_user_id && row.author_user_id === meId) return "Вы";
  const a = row.assignees;
  const name = Array.isArray(a) ? a[0]?.name : a?.name;
  return name || ownerLabel;
}

export function useItemComments(kind: ItemKind, itemId: string) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async (): Promise<Comment[]> => {
    if (!itemId) return [];
    const db = createClient();
    const { data: me } = await db.auth.getUser();
    const meId = me?.user?.id || "";

    const [{ data: rows }, { data: reactions }] = await Promise.all([
      db
        .from("item_comments")
        .select("id, body, attachments, created_at, edited_at, source, author_user_id, author_assignee_id, assignees(name)")
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
      return {
        id: row.id,
        body: row.body,
        attachments: (row.attachments || []).map((a) => ({ ...a, url: urlByPath.get(a.path) })),
        createdAt: row.created_at,
        editedAt: row.edited_at,
        authorName: nameOf(row, meId, "Кирилл"),
        mine,
        source: row.source,
        reactions: [...grouped.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
      };
    });
  }, [kind, itemId]);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then((list) => {
      if (cancelled) return;
      setComments(list);
      setLoading(false);
    });

    const db = createClient();
    const channel = db
      .channel(`comments-${kind}-${itemId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "item_comments" }, () => {
        fetchAll().then((list) => {
          if (!cancelled) setComments(list);
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "comment_reactions" }, () => {
        fetchAll().then((list) => {
          if (!cancelled) setComments(list);
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [fetchAll, kind, itemId]);

  const reload = useCallback(async () => setComments(await fetchAll()), [fetchAll]);

  const send = useCallback(
    async (body: string, files: File[] = []) => {
      const text = body.trim();
      if ((!text && !files.length) || !itemId) return;
      const db = createClient();
      const { data: me } = await db.auth.getUser();
      // Оба поля пишутся сразу: у вошедшего в трекер есть и логин, и строка
      // в списке людей, а имя потом нужно показать независимо от того,
      // через какую дверь сообщение пришло.
      const { data: member } = await db
        .from("workspace_members")
        .select("assignee_id")
        .eq("member_id", me?.user?.id || "")
        .maybeSingle();
      // Путь начинается с пространства: по первому сегменту права и
      // решают, чей это файл (см. миграцию 0020). Владелец пишет в своё,
      // руководитель — в то, куда принят.
      const workspace = (member as { owner_id?: string } | null)?.owner_id || me?.user?.id || "";
      const attachments: Attachment[] = [];
      for (const file of files) {
        const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
        const path = `${workspace}/${kind}/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
        const { error: upErr } = await db.storage.from(BUCKET).upload(path, file, { upsert: false });
        if (upErr) throw new Error(`Не загрузился файл «${file.name}»: ${upErr.message}`);
        attachments.push({ path, name: file.name, size: file.size, type: file.type });
      }

      const { error } = await db.from("item_comments").insert({
        item_kind: kind,
        item_id: itemId,
        body: text,
        attachments,
        author_user_id: me?.user?.id || null,
        author_assignee_id: (member as { assignee_id?: string } | null)?.assignee_id || null,
        source: "app",
      });
      await reload();
      // Сообщение, которое не сохранилось, не должно исчезнуть молча: чаще
      // всего это задача, ещё не доехавшая до облака, и человеку надо дать
      // повторить, а не гадать, куда делся его текст.
      if (error) throw new Error(error.message);
    },
    [kind, itemId, reload],
  );

  // Своё сообщение можно поправить или убрать; чужое — нет. Удаление мягкое:
  // переписку, которую можно незаметно переписать задним числом, незачем
  // было и заводить.
  const edit = useCallback(
    async (commentId: string, body: string) => {
      const db = createClient();
      await db.from("item_comments").update({ body: body.trim(), edited_at: new Date().toISOString() }).eq("id", commentId);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (commentId: string) => {
      const db = createClient();
      await db.from("item_comments").update({ deleted_at: new Date().toISOString() }).eq("id", commentId);
      await reload();
    },
    [reload],
  );

  // Нажатие на уже поставленную реакцию её снимает — иначе единственный
  // способ передумать это попросить кого-то другого.
  const react = useCallback(
    async (commentId: string, emoji: string, on: boolean) => {
      const db = createClient();
      const { data: me } = await db.auth.getUser();
      const meId = me?.user?.id || "";
      if (!on) {
        await db.from("comment_reactions").delete().eq("comment_id", commentId).eq("emoji", emoji).eq("actor_user_id", meId);
      } else {
        const { data: member } = await db
          .from("workspace_members")
          .select("assignee_id")
          .eq("member_id", meId)
          .maybeSingle();
        await db.from("comment_reactions").insert({
          comment_id: commentId,
          emoji,
          actor_user_id: meId,
          actor_assignee_id: (member as { assignee_id?: string } | null)?.assignee_id || null,
        });
      }
      await reload();
    },
    [reload],
  );

  return { comments, loading, send, edit, remove, react };
}
