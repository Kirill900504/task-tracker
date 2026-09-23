"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { me } from "@/lib/me";
import { onRevive } from "@/lib/revive";

// Сколько непрочитанного лежит в обсуждении каждой задачи — для значка на
// кубике доски (пункт «количество непрочитанных сообщений внутри задачи»,
// 23.09.2026).
//
// Точка отсчёта «когда я это читал» — своя у каждого браузера и лежит в
// localStorage, а не в базе: это удобство того, кто смотрит на доску
// именно с этого устройства (см. правило про localStorage — только для
// того, что не обязано совпадать у всех и не обязано доходить до Клода).
// Заводить для этого таблицу и колонку означало бы то самое «а нужно ли
// это действительно всем и всегда» — здесь не нужно: отметка «непрочитано»
// мимо одного устройства не стоит переноса на сервер.
const READ_KEY = "rokas:comments-read";

function readMarks(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

// Открыли карточку — обсуждение внутри неё считается прочитанным. Зовётся
// из TaskModal при открытии существующей задачи.
export function markTaskCommentsRead(taskId: string) {
  if (!taskId) return;
  try {
    const marks = readMarks();
    marks[taskId] = new Date().toISOString();
    localStorage.setItem(READ_KEY, JSON.stringify(marks));
  } catch {
    // Приватный режим или запрет на хранилище — переживём без метки, значок
    // просто продолжит показывать то же число.
  }
}

type Row = { item_id: string; created_at: string; author_user_id: string | null };

export function useUnreadTaskComments(taskIds: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Список карточек на доске меняется на каждое перетаскивание и фильтр —
  // а сравнивать эффекту нужно СОДЕРЖИМОЕ, а не ссылку на новый массив.
  const key = [...taskIds].sort().join(",");

  useEffect(() => {
    let cancelled = false;
    const db = createClient();

    async function pull() {
      // Пусто — нечего спрашивать, и нечего показывать: пустой список
      // задач на доске не рисует ни одного кубика, читать значение для
      // отсутствующей карточки некому.
      if (!taskIds.length) return;
      const { userId } = await me();
      const marks = readMarks();
      // Постранично: PostgREST режет `in()` не по числу элементов, а по
      // длине самого запроса, и полсотни задач в одну строку укладываются
      // без остатка — на большее пространство здесь не рассчитано.
      const { data } = await db
        .from("item_comments")
        .select("item_id, created_at, author_user_id")
        .eq("item_kind", "task")
        .in("item_id", taskIds)
        .eq("system", false)
        .is("deleted_at", null);
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const row of (data || []) as Row[]) {
        // Своё написанное не считается непрочитанным собственным автором.
        if (row.author_user_id && row.author_user_id === userId) continue;
        const since = marks[row.item_id];
        if (since && row.created_at <= since) continue;
        next[row.item_id] = (next[row.item_id] || 0) + 1;
      }
      setCounts(next);
    }

    void pull();
    // Обсуждение обновляется репликами, а доска про них не подписана —
    // то же правило, что у остального в трекере (lib/revive.ts): без
    // подписки на каждую отдельную задачу разом (дорого) счётчик догоняет
    // раз в минуту и по обычным поводам вернуться на вкладку.
    const stopRevive = onRevive(pull, { everyMs: 60_000 });
    return () => {
      cancelled = true;
      stopRevive();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- taskIds сравнивается через `key`
  }, [key]);

  return counts;
}
