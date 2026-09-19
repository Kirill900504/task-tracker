"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SearchResult } from "@/lib/localSearch";

// Поиск по обсуждениям.
//
// Обычный поиск смотрит названия и описания — то есть то, что уже лежит в
// памяти вкладки, и потому обновляется на каждую букву. Половина того, что
// люди помнят, сказана не там: «мы же договорились про 25-е» живёт в
// реплике, а не в заголовке.
//
// Реплики в память не тянутся и тянуться не должны: их тысячи, они читаются
// только вместе с открытой задачей, и держать их все ради поиска значило бы
// платить памятью за вопрос, который задают раз в неделю. Поэтому здесь
// запрос к базе — и с задержкой, чтобы он не уходил на каждую букву.

const MIN_LENGTH = 3;
const DEBOUNCE_MS = 350;

// Состояние — это ОТВЕТ вместе с вопросом, на который он получен.
//
// Так «идёт поиск» и «нашлось» выводятся во время отрисовки, а не
// записываются в состояние вторым вызовом: правило React-компилятора
// запрещает setState прямо в теле эффекта, и оно право — состояние,
// вычисляемое из пропса, состоянием быть не должно.
type Answer = { query: string; rows: SearchResult[] };

export function useCommentSearch(query: string): { results: SearchResult[]; searching: boolean } {
  const [answer, setAnswer] = useState<Answer>({ query: "", rows: [] });

  const run = useCallback(async (text: string): Promise<SearchResult[]> => {
    const db = createClient();
    // ilike, а не полнотекстовый поиск: русская морфология требует словаря,
    // которого в базе нет, а «договорил» внутри «договорились» находится и
    // так. Ограничение по количеству — чтобы длинная переписка не вернулась
    // целиком на слово из трёх букв.
    const { data } = await db
      .from("item_comments")
      .select("id, item_kind, item_id, body, created_at, assignees(name)")
      .is("deleted_at", null)
      .eq("system", false)
      .ilike("body", `%${text}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    type Row = {
      id: string;
      item_kind: "task" | "meeting" | "idea";
      item_id: string;
      body: string;
      created_at: string;
      assignees: { name: string } | { name: string }[] | null;
    };

    return ((data as unknown as Row[]) || []).map((r) => {
      const a = r.assignees;
      const who = (Array.isArray(a) ? a[0]?.name : a?.name) || "Кирилл";
      const when = new Date(r.created_at);
      const date = Number.isNaN(when.getTime())
        ? ""
        : `${String(when.getDate()).padStart(2, "0")}.${String(when.getMonth() + 1).padStart(2, "0")}`;
      return {
        // Открывается САМ ИТЕМ, а не реплика: читать её в отрыве от того, о
        // чём она, всё равно бессмысленно.
        kind: r.item_kind,
        id: r.item_id,
        title: r.body.length > 90 ? r.body.slice(0, 89) + "…" : r.body,
        meta: [who, date].filter(Boolean).join(" · "),
        done: false,
      };
    });
  }, []);

  useEffect(() => {
    const text = query.trim();
    // Короткий запрос не ищется вовсе, и состояние ради этого не трогается:
    // ответ на него выводится ниже, при отрисовке.
    if (text.length < MIN_LENGTH) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      run(text)
        .then((rows) => {
          if (!cancelled) setAnswer({ query: text, rows });
        })
        .catch(() => {
          // Сеть. Поиск по названиям при этом продолжает работать — он в
          // памяти, — и молчать здесь честнее, чем показывать ошибку вместо
          // найденного.
          if (!cancelled) setAnswer({ query: text, rows: [] });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, run]);

  const text = query.trim();
  if (text.length < MIN_LENGTH) return { results: [], searching: false };
  const fresh = answer.query === text;
  return { results: fresh ? answer.rows : [], searching: !fresh };
}
