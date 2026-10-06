"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { createSharedStore } from "@/lib/sharedStore";

// Кто из людей — какой логин.
//
// Задача помнит своего постановщика колонкой `created_by`, и это auth-id:
// на карточке его не покажешь. Имя лежит через одну таблицу — членство
// связывает логин со строкой человека, а у строки есть имя.
//
// Нужно это ровно там, где спрашивают «а это чьё поручение»: пока задачи
// ставил один Кирилл, ответ был очевиден, а с четырнадцатью постановщиками
// половина списка станет чужими поручениями без единого признака.
//
// Пусто у того, кто работает один: своё пространство, членств нет, и
// каждая карточка молчит о постановщике — правильно, он там один.
//
// Общим store с подпиской, а не «один запрос на жизнь вкладки», как было.
// 24.09.2026 Станислав Синецкий открыл задачу, которую сам поручил, и в
// «Постановщике» прочёл «бывший участник»: единственный запрос ушёл раньше,
// чем сессия была готова (или промахнулся по сети), вернул пустой список —
// и пустое навсегда осталось «правдой» до перезагрузки. Ошибка при чтении
// теперь не превращается в пустой список, а изменение членства или
// переименование человека перечитывают его само.

async function fetchAll(): Promise<Record<string, string> | null> {
  const db = createClient();
  const { data, error } = await db
    .from("workspace_members")
    .select("member_id, assignees(name)")
    .not("member_id", "is", null);
  if (error || !data) return null;

  type Row = { member_id: string; assignees: { name: string } | { name: string }[] | null };
  const out: Record<string, string> = {};
  for (const row of data as unknown as Row[]) {
    const a = row.assignees;
    const name = (Array.isArray(a) ? a[0]?.name : a?.name) || "";
    if (row.member_id && name) out[row.member_id] = name;
  }
  return out;
}

const store = createSharedStore<Record<string, string>>({}, fetchAll, ["workspace_members", "assignees"]);

export function useAuthors(): Record<string, string> {
  const { data } = useSyncExternalStore(store.subscribe, store.snapshot, store.serverSnapshot);
  useEffect(() => {
    store.ensure();
  }, []);
  return data;
}
