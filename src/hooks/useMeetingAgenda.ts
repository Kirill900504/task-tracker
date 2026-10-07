"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { coalescer } from "@/lib/coalesce";
import { onRevive } from "@/lib/revive";
import { describeDbError } from "@/lib/syncError";

// Повестка встречи (миграция 0048). Своя таблица рядом со встречей, как
// голоса и обсуждение: пункты дописывают все участники, а движок
// синхронизации встреч пишет только своё (см. «Participation lives outside
// the sync engine» в CLAUDE.md).

export type AgendaItem = {
  id: string;
  text: string;
  note: string;
  position: number;
  authorId: string;
};

type Row = { id: string; text: string; note: string; position: number; author_id: string };

async function load(meetingId: string): Promise<AgendaItem[] | null> {
  const { data, error } = await createClient()
    .from("meeting_agenda")
    .select("id, text, note, position, author_id")
    .eq("meeting_id", meetingId)
    .order("position")
    .order("created_at");
  if (error) return null;
  return ((data || []) as Row[]).map((r) => ({ id: r.id, text: r.text, note: r.note || "", position: r.position, authorId: r.author_id }));
}

export function useMeetingAgenda(meetingId: string) {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;
    const reader = coalescer(async () => {
      const next = await load(meetingId);
      if (cancelled || !next) return;
      setItems(next);
      setLoaded(true);
    });
    void reader.now();
    const db = createClient();
    // Уникальное имя канала — по той же причине, что в useMeetingVotes.
    const channel = db
      .channel("meeting-agenda:" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_agenda", filter: `meeting_id=eq.${meetingId}` }, reader.soon)
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !reader.startedWithin(2000)) reader.soon();
      });
    const stopRevive = onRevive(reader.soon);
    return () => {
      cancelled = true;
      reader.stop();
      stopRevive();
      void db.removeChannel(channel);
    };
  }, [meetingId]);

  // Экран меняется раньше базы, перечитывается — только если запись не прошла.
  const fail = useCallback(
    async (message: string) => {
      setError(message);
      const fresh = await load(meetingId);
      if (fresh) setItems(fresh);
    },
    [meetingId],
  );

  const add = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setError("");
      const position = items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0;
      const temp: AgendaItem = { id: "tmp-" + Math.random().toString(36).slice(2), text: clean, note: "", position, authorId: "" };
      setItems((list) => [...list, temp]);
      const { data, error: err } = await createClient()
        .from("meeting_agenda")
        .insert({ meeting_id: meetingId, text: clean, position })
        .select("id, text, note, position, author_id")
        .maybeSingle();
      if (err || !data) return fail("Пункт не сохранился: " + (err ? describeDbError(err) : "нет ответа"));
      const r = data as Row;
      setItems((list) => list.map((i) => (i.id === temp.id ? { id: r.id, text: r.text, note: r.note || "", position: r.position, authorId: r.author_id } : i)));
    },
    [items, meetingId, fail],
  );

  const setNote = useCallback(
    async (id: string, note: string) => {
      setError("");
      setItems((list) => list.map((i) => (i.id === id ? { ...i, note } : i)));
      const { error: err } = await createClient().from("meeting_agenda").update({ note: note.trim() }).eq("id", id);
      if (err) await fail("Итог по пункту не сохранился: " + describeDbError(err));
    },
    [fail],
  );

  const remove = useCallback(
    async (id: string) => {
      setError("");
      setItems((list) => list.filter((i) => i.id !== id));
      const { error: err } = await createClient().from("meeting_agenda").delete().eq("id", id);
      if (err) await fail("Пункт не убрался: " + describeDbError(err));
    },
    [fail],
  );

  return { items, loaded, error, add, setNote, remove };
}
