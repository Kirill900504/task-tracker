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

// Пункт, ещё не доехавший до базы, живёт под временным номером. Нажать
// «Итог» или «Убрать» у него можно сразу — и тогда запись обязана
// дождаться настоящего номера, иначе база отвергает «tmp-…» как не-uuid.
// Поймано e2e 07.10.2026: итог, записанный сразу после пункта, не
// сохранялся вовсе.
const realIds = new Map<string, Promise<string | null>>();
async function realId(id: string): Promise<string | null> {
  return id.startsWith("tmp-") ? ((await realIds.get(id)) ?? null) : id;
}

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
      const request = createClient()
        .from("meeting_agenda")
        .insert({ meeting_id: meetingId, text: clean, position })
        .select("id, text, note, position, author_id")
        .maybeSingle();
      realIds.set(
        temp.id,
        Promise.resolve(request).then(
          ({ data }) => (data as Row | null)?.id ?? null,
          () => null,
        ),
      );
      const { data, error: err } = await request;
      if (err || !data) return fail("Пункт не сохранился: " + (err ? describeDbError(err) : "нет ответа"));
      const r = data as Row;
      // Итог, записанный, пока пункт ехал, не теряется при подмене номера.
      setItems((list) =>
        list.map((i) => (i.id === temp.id ? { id: r.id, text: r.text, note: i.note || r.note || "", position: r.position, authorId: r.author_id } : i)),
      );
    },
    [items, meetingId, fail],
  );

  const setNote = useCallback(
    async (id: string, note: string) => {
      setError("");
      setItems((list) => list.map((i) => (i.id === id ? { ...i, note } : i)));
      const real = await realId(id);
      if (!real) return fail("Пункт ещё не сохранился — итог не записан");
      const { error: err } = await createClient().from("meeting_agenda").update({ note: note.trim() }).eq("id", real);
      if (err) await fail("Итог по пункту не сохранился: " + describeDbError(err));
    },
    [fail],
  );

  const remove = useCallback(
    async (id: string) => {
      setError("");
      setItems((list) => list.filter((i) => i.id !== id));
      const real = await realId(id);
      if (!real) return;
      const { error: err } = await createClient().from("meeting_agenda").delete().eq("id", real);
      if (err) await fail("Пункт не убрался: " + describeDbError(err));
    },
    [fail],
  );

  return { items, loaded, error, add, setNote, remove };
}
