"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

export function useAuthors(): Record<string, string> {
  const [byUserId, setByUserId] = useState<Record<string, string>>({});

  const fetchAll = useCallback(async (): Promise<Record<string, string>> => {
    const db = createClient();
    const { data } = await db
      .from("workspace_members")
      .select("member_id, assignees(name)")
      .not("member_id", "is", null);

    type Row = { member_id: string; assignees: { name: string } | { name: string }[] | null };
    const out: Record<string, string> = {};
    for (const row of ((data as unknown as Row[]) || [])) {
      const a = row.assignees;
      const name = (Array.isArray(a) ? a[0]?.name : a?.name) || "";
      if (row.member_id && name) out[row.member_id] = name;
    }
    return out;
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Запрос один и на всю жизнь вкладки: членства меняются приглашением,
    // то есть раз в несколько недель, и перечитывать их по подписке значило
    // бы держать канал ради события, которого не будет.
    fetchAll().then((map) => {
      if (!cancelled) setByUserId(map);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  return byUserId;
}
