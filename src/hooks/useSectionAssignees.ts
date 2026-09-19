"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TaskParticipantRole } from "@/lib/taskProgress";
import { createSharedStore } from "@/lib/sharedStore";

// Кто отвечает за раздел.
//
// Слова Кирилла 19.09.2026: «если тыкаешь левой кнопкой мыши, делался
// отбор по разделу, а если правой — сразу вылазило окно создания новой
// задачи с уже выделенными исполнителями, ответственными за раздел (это я
// готов заполнить и привязать каждого участника к разделу)».
//
// Заполняется один раз, а работает в двух местах: правая кнопка по разделу
// в трекере и — когда дойдут руки до ботов — кнопка «поручить по разделу»
// вместо выбора людей по одному.
//
// Общим store, как команда и по той же причине: этот список читают строка
// разделов, окно настройки разделов и форма задачи, а запрос должен быть
// один. Устаревание ловится realtime по самой таблице (миграция 0036).

export type SectionAssignee = {
  id: string;
  sectionId: string;
  assigneeId: string;
  role: TaskParticipantRole;
};

async function fetchRows(): Promise<SectionAssignee[] | null> {
  const db = createClient();
  const { data, error } = await db.from("section_assignees").select("id, section_id, assignee_id, role");
  if (error || !data) return null;
  return data.map((r) => ({
    id: r.id as string,
    sectionId: r.section_id as string,
    assigneeId: r.assignee_id as string,
    role: (r.role as TaskParticipantRole) || "executor",
  }));
}

const store = createSharedStore<SectionAssignee[]>([], fetchRows, ["section_assignees"]);

export function prefetchSectionAssignees() {
  store.ensure();
}

export function useSectionAssignees() {
  const { data: rows } = useSyncExternalStore(store.subscribe, store.snapshot, store.serverSnapshot);

  useEffect(() => {
    store.ensure();
  }, []);

  const forSection = useCallback((sectionId: string) => rows.filter((r) => r.sectionId === sectionId), [rows]);

  // Экран меняется сразу, база следом — как и всё остальное, что делается
  // кнопкой (правило «экран отвечает раньше облака»).
  const add = useCallback(async (sectionId: string, assigneeId: string, role: TaskParticipantRole, ownerId: string) => {
    const db = createClient();
    const { error } = await db
      .from("section_assignees")
      .upsert({ user_id: ownerId, section_id: sectionId, assignee_id: assigneeId, role }, { onConflict: "section_id,assignee_id" });
    await store.refresh();
    if (error) throw new Error(error.message);
  }, []);

  const remove = useCallback(async (id: string) => {
    const db = createClient();
    const { error } = await db.from("section_assignees").delete().eq("id", id);
    await store.refresh();
    if (error) throw new Error(error.message);
  }, []);

  return { rows, forSection, add, remove };
}
