"use client";

import { useCallback, useEffect, useState } from "react";
import { coalescer } from "@/lib/coalesce";
import { createClient } from "@/lib/supabase/client";
import { onRevive } from "@/lib/revive";
import type { IdeaRecipientRow } from "@/lib/ideaRecipients";

// Строки рассылки мыслей: кому мысль ушла и что он с ней сделал.
//
// Один экземпляр на панель мыслей (IdeasPanel) — оттуда автору уходит
// «кому отправлена», получателю «что прислали». Права решает база: автор
// видит строки своих мыслей (миграция 0050), получатель — свои, владелец
// пространства — все (и фильтрует по своим мыслям сам: панель показывает
// только их).

type Raw = {
  id: string;
  idea_id: string;
  assignee_id: string;
  seen_at: string | null;
  converted_task_id: string | null;
  created_at: string;
  ideas:
    | { text: string; created_by: string | null; created_at: string; done: boolean; deleted_at: string | null }
    | { text: string; created_by: string | null; created_at: string; done: boolean; deleted_at: string | null }[]
    | null;
};

function toRow(raw: Raw): IdeaRecipientRow {
  const idea = Array.isArray(raw.ideas) ? raw.ideas[0] || null : raw.ideas;
  return {
    id: raw.id,
    ideaId: raw.idea_id,
    assigneeId: raw.assignee_id,
    seenAt: raw.seen_at,
    convertedTaskId: raw.converted_task_id,
    createdAt: raw.created_at,
    idea: idea
      ? { text: idea.text, createdBy: idea.created_by, createdAt: idea.created_at, done: !!idea.done, deletedAt: idea.deleted_at }
      : null,
  };
}

export function useIdeaRecipients() {
  const [rows, setRows] = useState<IdeaRecipientRow[]>([]);

  const fetchAll = useCallback(async () => {
    const db = createClient();
    const { data } = await db
      .from("idea_recipients")
      .select("id, idea_id, assignee_id, seen_at, converted_task_id, created_at, ideas(text, created_by, created_at, done, deleted_at)");
    return ((data || []) as Raw[]).map(toRow);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Отправка мысли — несколько строк разом, и каждая приходит событием:
    // склеиваем их в одно чтение (lib/coalesce).
    const reader = coalescer(async () => {
      const next = await fetchAll();
      if (!cancelled) setRows(next);
    });
    void reader.now();

    const db = createClient();
    // Имя канала своё на каждый вызов: повторная подписка на уже
    // подписанный канал бросает исключение (см. useMeetingVotes).
    const channel = db
      .channel("idea-recipients:" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "idea_recipients" }, reader.soon)
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !reader.startedWithin(2000)) reader.soon();
      });
    // Подписка умирает молча — у мыслей тот же второй путь, что у всего
    // остального (lib/revive.ts).
    const stopRevive = onRevive(reader.soon);

    return () => {
      cancelled = true;
      reader.stop();
      stopRevive();
      void db.removeChannel(channel);
    };
  }, [fetchAll]);

  // Экран отвечает раньше облака: ответ рисуется сразу, а не после
  // перечитывания. Не прошла запись — перечитываем, и строка возвращается.
  const markLocally = useCallback((rowId: string, patch: Partial<IdeaRecipientRow>) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  }, []);

  const reload = useCallback(async () => setRows(await fetchAll()), [fetchAll]);

  return { rows, markLocally, reload };
}
