"use client";

import { useState } from "react";
import type { IdeaRecipientRow } from "@/lib/ideaRecipients";
import { formatIdeaCreatedAt } from "@/lib/trackerRows";
import Icon from "./Icon";
import { humanError } from "@/lib/humanError";

// «Прислали вам» — приёмка чужих мыслей в самом трекере.
//
// До 07.10.2026 присланная мысль существовала для получателя только в
// мессенджере: панель мыслей показывает свои (NewTracker, `myIdeas`), и
// кнопка «Взять в работу» жила одна, под сообщением бота. Кирилл: «у
// получателя, помимо приёмки чужих мыслей в мессенджерах, должна так же
// быть какой-то формат приёмки в приложении на ПК и мобильной версии».
//
// Устроено как короткая очередь над своими мыслями: каждая присланная —
// кто, когда, что, и четыре ответа — те же, что под мыслью в мессенджере
// (08.10.2026). «В работу» и «Встреча» открывают обычные формы (см. пропсы
// ниже); «Сохранить» кладёт копию в мои мысли с сегодняшней датой, и она
// встаёт в общий порядок как только что записанная (его же решение
// 23.09.2026 — «получить и сохранить», см. docs/next-ten.md, п. 12);
// «Прочитать» — прочитал, у себя не храню. После любого ответа мысль уходит из блока, а автор видит ответ в
// списке «кому отправлена» у своей мысли. Блока нет вовсе, пока отвечать
// не на что: пустой заголовок над списком — та самая надпись, которая
// называет очевидное.
export default function IncomingIdeas({
  rows,
  authorOf,
  onAnswered,
  onKeep,
  onToTask,
  onToMeeting,
}: {
  rows: IdeaRecipientRow[];
  // Имя того, кто прислал (authorLabel: пустой created_by — владелец).
  authorOf: (createdBy: string | null) => string;
  // Ответ записан: убрать строку с экрана сразу или вернуть при отказе.
  onAnswered: (row: IdeaRecipientRow, answer: "taken" | "seen" | "failed") => void;
  // «Сохранить»: завести копию в своих мыслях. Зовётся только после того,
  // как ответ записан, — иначе отказ и повторное нажатие дали бы две копии.
  onKeep: (row: IdeaRecipientRow) => void;
  // «В работу» и «Встреча» открывают ОБЫЧНЫЕ формы новой задачи и новой
  // встречи — с названием из мысли (и автором мысли в составе встречи).
  // Ответ записывается только после «Сохранить»: «Отмена» оставляет мысль
  // в блоке. Так же, как в мессенджере (lib/ideaInbox), задачу можно
  // поручить и себе, и коллеге — слова Кирилла 08.10.2026: «взять в
  // работу — то есть создать на себя или коллегу конкретную задачу,
  // назначить встречу — создать на основании мысли встречу».
  onToTask: (row: IdeaRecipientRow) => void;
  onToMeeting: (row: IdeaRecipientRow) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);

  if (!rows.length) return null;

  async function answer(row: IdeaRecipientRow, action: "ack_idea" | "keep_idea") {
    const keep = action === "keep_idea";
    setBusy(row.id);
    setError(null);
    // Экран отвечает раньше облака — строка уходит сразу, а не после ответа.
    onAnswered(row, "seen");
    try {
      const res = await fetch("/api/workspace/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, recipientId: row.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) throw new Error(data?.error || "Не получилось ответить");
      if (keep) onKeep(row);
    } catch (e) {
      onAnswered(row, "failed");
      setError({ id: row.id, text: humanError(e, "Не получилось ответить") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="incoming-ideas" id="incomingIdeas">
      <div className="incoming-ideas-head">
        <Icon name="inbox" size={14} /> Прислали вам <span className="count">{rows.length}</span>
      </div>
      {rows.map((row) => (
        <div className="incoming-idea" key={row.id} data-incoming-idea={row.ideaId}>
          <div className="incoming-idea-text">{row.idea?.text}</div>
          <div className="incoming-idea-meta">
            от {authorOf(row.idea?.createdBy ?? null)} · {formatIdeaCreatedAt(row.createdAt)}
          </div>
          <div className="incoming-idea-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy === row.id}
              title="Завести задачу — себе или коллеге"
              onClick={() => onToTask(row)}
            >
              В работу
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy === row.id}
              title="Назначить встречу по этой мысли"
              onClick={() => onToMeeting(row)}
            >
              Встреча
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy === row.id}
              title="Сохранить в свои мысли"
              onClick={() => void answer(row, "keep_idea")}
            >
              Сохранить
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy === row.id}
              title="Прочитал — задачей это не станет"
              onClick={() => void answer(row, "ack_idea")}
            >
              Прочитать
            </button>
          </div>
          {error?.id === row.id && <div className="send-result">{error.text}</div>}
        </div>
      ))}
    </div>
  );
}
