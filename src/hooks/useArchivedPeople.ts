"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { createSharedStore } from "@/lib/sharedStore";
import { withoutSelfMark } from "@/lib/actorName";

// Кого убрали из команды (миграция 0055) — именами.
//
// Убранный уходит из всех списков ВЫБОРА, но остаётся в истории: на
// закрытой задаче он исполнитель, на прошедшей встрече — участник, в
// обсуждении — автор реплики. Без пометки это имя читается как живой
// коллега, которому можно написать или поручить, и вопрос «а где он в
// списке?» остаётся без ответа. Слова Кирилла 21.10.2026: «в событиях уже
// созданных… был маркер, что пользователь такой-то, имя сохраняется, но
// уже удалён».
//
// Сравнение по имени, а не по id: участники встречи и постановщик живут
// именами, а имя в пространстве уникально и у убранных тоже (добавление
// человека с именем убранного возвращает его, а не заводит второго).
//
// Общим store с подпиской на `assignees`: убрали или вернули человека в
// одном окне — пометка появляется и снимается во всех открытых сразу.

async function fetchArchived(): Promise<string[] | null> {
  const { data, error } = await createClient().from("assignees").select("name").not("archived_at", "is", null);
  if (error || !data) return null;
  return (data as { name: string }[]).map((r) => withoutSelfMark(r.name || "").trim()).filter(Boolean);
}

const store = createSharedStore<string[]>([], fetchArchived, ["assignees"]);

export function useArchivedPeople(): (name: string | null | undefined) => boolean {
  const { data } = useSyncExternalStore(store.subscribe, store.snapshot, store.serverSnapshot);
  useEffect(() => {
    store.ensure();
  }, []);
  return useCallback((name) => !!name && data.includes(withoutSelfMark(name).trim()), [data]);
}
