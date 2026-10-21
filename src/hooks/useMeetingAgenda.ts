"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { coalescer } from "@/lib/coalesce";
import { onRevive } from "@/lib/revive";
import { describeDbError } from "@/lib/syncError";
import { writeQueue } from "@/lib/writeQueue";

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

// Экспортирован ради окна «Задачи из повестки» (MeetingsPanel): после
// «Успех / Провал» повестку читают один раз, без подписки.
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

export { load as loadAgenda };

// Повестка, набранная в форме НОВОЙ встречи (21.10.2026: «поле повестка
// должно быть доступно при создании любой встречи»). Встреча в эту секунду
// ещё только едет в облако — локальное состояние истина, запись идёт своим
// ходом, — и пункт, вставленный раньше неё, внешний ключ отверг бы молча.
// Поэтому сперва ждём строку встречи, как useMeetingVotes.sync, и только
// потом пишем пункты одной пачкой (у всех строк одни и те же ключи — см.
// правило про пачки PostgREST в CLAUDE.md).
export async function saveAgendaDraft(meetingId: string, texts: string[]): Promise<boolean> {
  const items = texts.map((t) => t.trim().slice(0, 500)).filter(Boolean);
  if (!items.length) return true;
  const db = createClient();
  let exists = false;
  for (let attempt = 0; attempt < 12 && !exists; attempt++) {
    const { data } = await db.from("meetings").select("id").eq("id", meetingId).maybeSingle();
    if (data) exists = true;
    else await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!exists) return false;
  const { error } = await db.from("meeting_agenda").insert(items.map((text, position) => ({ meeting_id: meetingId, text, position })));
  return !error;
}

export function useMeetingAgenda(meetingId: string) {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  // Записи — одной очередью, а перечитанное не перекрывает летящее
  // (lib/writeQueue): иначе второй пункт, набранный сразу за первым,
  // пропадал на секунду — его стирало перечитывание от эха первого.
  const [queue] = useState(() => writeQueue(setError));

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;
    const reader = coalescer(
      queue.guard(
        () => load(meetingId),
        (next) => {
          if (cancelled) return;
          setItems(next);
          setLoaded(true);
        },
        () => reader.soon(),
      ),
    );
    queue.onSettled(reader.soon);
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
      queue.onSettled(() => {});
      reader.stop();
      stopRevive();
      void db.removeChannel(channel);
    };
  }, [meetingId, queue]);

  const write = queue.write;

  const add = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return Promise.resolve();
      setError("");
      const position = items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0;
      const temp: AgendaItem = { id: "tmp-" + Math.random().toString(36).slice(2), text: clean, note: "", position, authorId: "" };
      setItems((list) => [...list, temp]);
      // Временный номер ждёт настоящего: итог или «Убрать», нажатые, пока
      // пункт ехал, встают в ту же очередь и получат его. Построитель
      // Supabase ждётся здесь ровно один раз — на каждый `.then` он уходит
      // в сеть заново (08.10.2026 одно нажатие Enter писало пункт дважды).
      let settle: (id: string | null) => void = () => {};
      realIds.set(temp.id, new Promise<string | null>((resolve) => (settle = resolve)));
      return write(async () => {
        try {
          const { data, error: err } = await createClient()
            .from("meeting_agenda")
            .insert({ meeting_id: meetingId, text: clean, position })
            .select("id, text, note, position, author_id")
            .maybeSingle();
          const r = data as Row | null;
          settle(r?.id ?? null);
          if (err || !r) return "Пункт не сохранился: " + (err ? describeDbError(err) : "нет ответа");
          // Итог, записанный, пока пункт ехал, не теряется при подмене номера.
          setItems((list) =>
            list.map((i) => (i.id === temp.id ? { id: r.id, text: r.text, note: i.note || r.note || "", position: r.position, authorId: r.author_id } : i)),
          );
          return null;
        } finally {
          settle(null);
        }
      });
    },
    [items, meetingId, write],
  );

  const setNote = useCallback(
    (id: string, note: string) => {
      setError("");
      setItems((list) => list.map((i) => (i.id === id ? { ...i, note } : i)));
      return write(async () => {
        const real = await realId(id);
        if (!real) return "Пункт ещё не сохранился — итог не записан";
        const { error: err } = await createClient().from("meeting_agenda").update({ note: note.trim() }).eq("id", real);
        return err ? "Итог по пункту не сохранился: " + describeDbError(err) : null;
      });
    },
    [write],
  );

  const remove = useCallback(
    (id: string) => {
      setError("");
      setItems((list) => list.filter((i) => i.id !== id));
      return write(async () => {
        const real = await realId(id);
        if (!real) return null;
        const { error: err } = await createClient().from("meeting_agenda").delete().eq("id", real);
        return err ? "Пункт не убрался: " + describeDbError(err) : null;
      });
    },
    [write],
  );

  return { items, loaded, error, add, setNote, remove };
}
