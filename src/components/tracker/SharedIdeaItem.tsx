"use client";

import { useState } from "react";
import type { IdeaRecipientRow } from "@/lib/ideaRecipients";
import { formatIdeaCreatedAt } from "@/lib/trackerRows";
import Icon from "./Icon";

// Мысль, которой со мной ПОДЕЛИЛИСЬ (миграция 0051).
//
// Решение Кирилла 23.09.2026: «поделиться» — мысль остаётся у автора и
// просто становится видна получателю, «ничего не подтверждается». Поэтому
// она лежит в общем списке мыслей, а не в блоке «Прислали вам», где ждут
// ответа: выглядит как своя, только с подписью, от кого, и без того, что
// с чужой записью делать нельзя (править, вычёркивать, отмечать «важно» —
// это строка автора, и база откажет молча). Остаётся два действия: взять в
// работу (тот же маршрут, что у отправленной) и убрать у себя.
export default function SharedIdeaItem({
  row,
  from,
  onAnswered,
}: {
  row: IdeaRecipientRow;
  // Кто поделился — именем.
  from: string;
  onAnswered: (row: IdeaRecipientRow, answer: "taken" | "seen" | "failed") => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function answer(action: "take_idea" | "ack_idea") {
    setBusy(true);
    setError("");
    // Экран отвечает раньше облака: строка уходит сразу.
    onAnswered(row, action === "take_idea" ? "taken" : "seen");
    try {
      const res = await fetch("/api/workspace/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, recipientId: row.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) throw new Error(data?.error || "Не получилось");
    } catch (e) {
      onAnswered(row, "failed");
      setError(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="idea-item idea-shared" data-shared-idea={row.ideaId}>
      <div className="idea-shared-body">
        <div className="idea-text">{row.idea?.text}</div>
        <div className="idea-meta">
          от {from} · {formatIdeaCreatedAt(row.createdAt)}
        </div>
      </div>
      <div className="idea-shared-actions">
        <button
          type="button"
          className="idea-take"
          disabled={busy}
          title="Завести себе задачу из этой мысли"
          onClick={() => void answer("take_idea")}
        >
          В работу
        </button>
        <button
          type="button"
          className="idea-del"
          disabled={busy}
          title="Убрать у себя — у автора мысль останется"
          aria-label="Убрать у себя"
          onClick={() => void answer("ack_idea")}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
      {error && <div className="send-result">{error}</div>}
    </div>
  );
}
