"use client";

// Port of checkSyncErrors() from legacy-tracker.js. A save that failed in a
// *previous* session left only a toast, long gone by the time the tab is
// reopened — so unacknowledged sync_errors rows are surfaced here as a
// dismissable banner instead, listing how many and the most recent message.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Icon from "./Icon";

// Строка, из которой ничего не следует.
//
// «[object Object]» — это отказ базы, потерянный по дороге сюда (см.
// lib/syncError.ts: он был объектом, а его превращали в строку). Такие
// строки в базе уже лежат, и показывать их как есть — значит пугать
// человека тем, чего он всё равно не прочитает.
function unreadable(message: string): boolean {
  const text = (message || "").trim();
  return !text || /^\[object .*\]$/i.test(text);
}

export default function SyncErrorBanner() {
  const [errors, setErrors] = useState<{ ids: string[]; count: number; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const db = createClient();
    db.from("sync_errors")
      .select("id, message, created_at")
      .eq("acknowledged", false)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled || error || !data || !data.length) return;
        setErrors({ ids: data.map((r) => r.id as string), count: data.length, message: (data[0].message as string) || "" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!errors) return null;

  function dismiss() {
    if (!errors) return;
    const db = createClient();
    db.from("sync_errors").update({ acknowledged: true }).in("id", errors.ids).then(() => {});
    setErrors(null);
  }

  // Плавающая карточка, а не полоса в потоке страницы.
  //
  // До 23.09.2026 это был `.notif-banner` внутри панели задач: он раздвигал
  // всё, что под ним, и выглядел так же, как случайная поломка. Правило
  // Кирилла общее для всего трекера — ошибка не должна расширять форму или
  // блок, а всплывает поверх, — так что здесь та же плашка, что у
  // напоминания подключить мессенджер (.ms-link рядом), только своим
  // цветом: это ПРОШЛЫЙ отказ записи, обнаруженный при открытии, а не
  // призыв к действию.
  return (
    <div className="sync-error-notice" id="syncErrorBanner">
      <span className="sync-error-text">
        <Icon name="warning" size={14} /> Не всё сохранилось в облако ({errors.count}):{" "}
        {unreadable(errors.message)
          ? "что именно отказало, в тот раз не записалось. Если повторится — здесь будет написано, какая таблица и почему."
          : errors.message}
      </span>
      <button className="btn btn-small" onClick={dismiss}>
        Скрыть
      </button>
    </div>
  );
}
