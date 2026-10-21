"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { coalescer } from "@/lib/coalesce";
import { onRevive } from "@/lib/revive";
import { describeDbError } from "@/lib/syncError";
import { me } from "@/lib/me";
import { writeQueue } from "@/lib/writeQueue";

// Чек-лист задачи (миграция 0059) — своя таблица рядом с задачей, как
// повестка у встречи (useMeetingAgenda): шаги отмечают исполнители, а
// строку задачи пишет только постановщик через движок синхронизации.
//
// Экран меняется раньше базы (правило «Кнопка меняет экран, а потом базу»
// в CLAUDE.md); база догоняет очередью, и пока та не опустела, прочитанное
// с сервера экран не перекрывает.

export type ChecklistItem = { id: string; text: string; done: boolean; position: number; authorId: string };

type Row = { id: string; text: string; done: boolean; position: number; author_id: string };

// Шаг, ещё не доехавший до базы, живёт под временным номером; отметить или
// убрать его можно сразу — запись дождётся настоящего номера (тот же урок,
// что у повестки, 07.10.2026).
const realIds = new Map<string, Promise<string | null>>();
async function realId(id: string): Promise<string | null> {
  return id.startsWith("tmp-") ? ((await realIds.get(id)) ?? null) : id;
}

async function load(taskId: string): Promise<ChecklistItem[] | null> {
  const { data, error } = await createClient()
    .from("task_checklist")
    .select("id, text, done, position, author_id")
    .eq("task_id", taskId)
    .order("position")
    .order("created_at");
  if (error) return null;
  return ((data || []) as Row[]).map((r) => ({ id: r.id, text: r.text, done: r.done, position: r.position, authorId: r.author_id }));
}

export function useTaskChecklist(taskId: string) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  // Записи — одной очередью, а перечитанное не перекрывает летящее
  // (lib/writeQueue: «нажал, а галка сама отжалась обратно», 21.10.2026).
  const [queue] = useState(() => writeQueue(setError));

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    const reader = coalescer(
      queue.guard(
        () => load(taskId),
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
    const channel = db
      .channel("task-checklist:" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_checklist", filter: `task_id=eq.${taskId}` }, reader.soon)
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
  }, [taskId, queue]);

  const write = queue.write;

  const add = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return Promise.resolve();
      setError("");
      const position = items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0;
      const temp: ChecklistItem = { id: "tmp-" + Math.random().toString(36).slice(2), text: clean, done: false, position, authorId: "" };
      setItems((list) => [...list, temp]);
      let settle: (id: string | null) => void = () => {};
      realIds.set(temp.id, new Promise<string | null>((resolve) => (settle = resolve)));
      return write(async () => {
        try {
          const { data, error: err } = await createClient()
            .from("task_checklist")
            .insert({ task_id: taskId, text: clean, position })
            .select("id, text, done, position, author_id")
            .maybeSingle();
          const r = data as Row | null;
          settle(r?.id ?? null);
          if (err || !r) return "Шаг не сохранился: " + (err ? describeDbError(err) : "нет ответа");
          setItems((list) => list.map((i) => (i.id === temp.id ? { ...i, id: r.id, authorId: r.author_id } : i)));
          return null;
        } finally {
          settle(null);
        }
      });
    },
    [items, taskId, write],
  );

  const toggle = useCallback(
    (id: string, done: boolean) => {
      setError("");
      setItems((list) => list.map((i) => (i.id === id ? { ...i, done } : i)));
      return write(async () => {
        const real = await realId(id);
        if (!real) return "Шаг ещё не сохранился — отметка не записана";
        const { userId } = await me();
        const { error: err } = await createClient()
          .from("task_checklist")
          .update({ done, done_at: done ? new Date().toISOString() : null, done_by: done ? userId || null : null })
          .eq("id", real);
        return err ? "Отметка не сохранилась: " + describeDbError(err) : null;
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
        const { error: err } = await createClient().from("task_checklist").delete().eq("id", real);
        return err ? "Шаг не убрался: " + describeDbError(err) : null;
      });
    },
    [write],
  );

  return { items, loaded, error, add, toggle, remove };
}

// Сколько шагов сделано по каждой задаче — для «3/5» на кубике. Одна
// выборка на всю доску (права базы сами оставят видимое), освежается
// подпиской и поводами догона.
export function useChecklistCounts(): Record<string, { done: number; total: number }> {
  const [counts, setCounts] = useState<Record<string, { done: number; total: number }>>({});
  useEffect(() => {
    let cancelled = false;
    const reader = coalescer(async () => {
      const { data, error } = await createClient().from("task_checklist").select("task_id, done");
      if (cancelled || error) return;
      const next: Record<string, { done: number; total: number }> = {};
      for (const r of (data || []) as { task_id: string; done: boolean }[]) {
        const c = (next[r.task_id] ||= { done: 0, total: 0 });
        c.total++;
        if (r.done) c.done++;
      }
      // Доска перерисовывается целиком на каждый новый объект, а событие
      // подписки приходит на любую галочку любой задачи, — одинаковое не
      // кладём (та же мера, что `sameLists` у движка синхронизации).
      setCounts((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    });
    void reader.now();
    const db = createClient();
    const channel = db
      .channel("task-checklist-counts:" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_checklist" }, reader.soon)
      .subscribe();
    const stopRevive = onRevive(reader.soon);
    return () => {
      cancelled = true;
      reader.stop();
      stopRevive();
      void db.removeChannel(channel);
    };
  }, []);
  return counts;
}
