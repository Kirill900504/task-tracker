"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { coalescer } from "@/lib/coalesce";
import { onRevive } from "@/lib/revive";
import { describeDbError } from "@/lib/syncError";

// Чек-лист задачи (миграция 0059) — своя таблица рядом с задачей, как
// повестка у встречи (useMeetingAgenda): шаги отмечают исполнители, а
// строку задачи пишет только постановщик через движок синхронизации.
//
// Экран меняется раньше базы, перечитывается — только если запись не
// прошла (правило «Кнопка меняет экран, а потом базу» в CLAUDE.md).

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

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    const reader = coalescer(async () => {
      const next = await load(taskId);
      if (cancelled || !next) return;
      setItems(next);
      setLoaded(true);
    });
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
      reader.stop();
      stopRevive();
      void db.removeChannel(channel);
    };
  }, [taskId]);

  const fail = useCallback(
    async (message: string) => {
      setError(message);
      const fresh = await load(taskId);
      if (fresh) setItems(fresh);
    },
    [taskId],
  );

  const add = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setError("");
      const position = items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0;
      const temp: ChecklistItem = { id: "tmp-" + Math.random().toString(36).slice(2), text: clean, done: false, position, authorId: "" };
      setItems((list) => [...list, temp]);
      // Построитель Supabase ленив и уходит в сеть на каждый `.then` — ждут
      // его двое, поэтому он один раз превращается в обещание (CLAUDE.md).
      const request = Promise.resolve(
        createClient().from("task_checklist").insert({ task_id: taskId, text: clean, position }).select("id, text, done, position, author_id").maybeSingle(),
      );
      realIds.set(
        temp.id,
        request.then(
          ({ data }) => (data as Row | null)?.id ?? null,
          () => null,
        ),
      );
      const { data, error: err } = await request;
      if (err || !data) return fail("Шаг не сохранился: " + (err ? describeDbError(err) : "нет ответа"));
      const r = data as Row;
      setItems((list) => list.map((i) => (i.id === temp.id ? { ...i, id: r.id, authorId: r.author_id } : i)));
    },
    [items, taskId, fail],
  );

  const toggle = useCallback(
    async (id: string, done: boolean) => {
      setError("");
      setItems((list) => list.map((i) => (i.id === id ? { ...i, done } : i)));
      const real = await realId(id);
      if (!real) return fail("Шаг ещё не сохранился — отметка не записана");
      const { data: me } = await createClient().auth.getSession();
      const { error: err } = await createClient()
        .from("task_checklist")
        .update({ done, done_at: done ? new Date().toISOString() : null, done_by: done ? me.session?.user.id ?? null : null })
        .eq("id", real);
      if (err) await fail("Отметка не сохранилась: " + describeDbError(err));
    },
    [fail],
  );

  const remove = useCallback(
    async (id: string) => {
      setError("");
      setItems((list) => list.filter((i) => i.id !== id));
      const real = await realId(id);
      if (!real) return;
      const { error: err } = await createClient().from("task_checklist").delete().eq("id", real);
      if (err) await fail("Шаг не убрался: " + describeDbError(err));
    },
    [fail],
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
      setCounts(next);
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
