"use client";

import { useState } from "react";
import type { IdeaRecipientRow } from "@/lib/ideaRecipients";
import { humanError } from "@/lib/humanError";

// Четыре ответа на чужую мысль — одни и те же у присланной («Прислали
// вам») и у поделённой (в списке мыслей). 22.10.2026, его слова: кнопки
// «маленькие, но заметные, по принципу кнопок своих мыслей», «👌» вместо
// «Прочитать», и «когда получаешь мысль, которой с тобой поделились,
// варианты действий такие же, как и в отправленной». Поэтому это один
// компонент, а не две копии ряда: у поделённой раньше было своё
// «В работу» (сразу задача на меня) и ×, и два ряда об одном расходились.
//
// Форма — .idea-act, ровно как «Создать / Отправить / Поделиться» под
// своей мыслью; подкрашено «Сохранить в мысли».
export default function ReceivedIdeaActions({
  row,
  onAnswered,
  onKeep,
  onToTask,
  onToMeeting,
}: {
  row: IdeaRecipientRow;
  // Ответ записан: убрать строку с экрана сразу или вернуть при отказе.
  onAnswered: (row: IdeaRecipientRow, answer: "taken" | "seen" | "failed") => void;
  // «Сохранить в мысли»: завести копию в своих мыслях. Зовётся только после
  // того, как ответ записан, — иначе отказ и повторное нажатие дали бы две
  // копии.
  onKeep: (row: IdeaRecipientRow) => void;
  // «В работу» и «Встреча» открывают ОБЫЧНЫЕ формы новой задачи и новой
  // встречи — с названием из мысли (и автором мысли в составе встречи).
  // Ответ записывается только после «Сохранить» в форме: «Отмена»
  // оставляет мысль на месте.
  onToTask: (row: IdeaRecipientRow) => void;
  onToMeeting: (row: IdeaRecipientRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function answer(action: "ack_idea" | "keep_idea") {
    setBusy(true);
    setError("");
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
      if (action === "keep_idea") onKeep(row);
    } catch (e) {
      onAnswered(row, "failed");
      setError(humanError(e, "Не получилось ответить"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Порядок и подсветка — его же, вторым кругом тем же днём: «ОК👌»
          левее всех, подсвечено «Сохранить в мысли», а «В работу» обычная.
          Имя «ОК👌» для чтения с экрана — словом «Прочитать»: так её
          находят и e2e. */}
      <div className="idea-actions received-idea-actions">
        <button
          type="button"
          className="idea-act idea-ok-act"
          disabled={busy}
          title="Прочитал — задачей это не станет, у себя не храню"
          aria-label="Прочитать"
          onClick={() => void answer("ack_idea")}
        >
          ОК👌
        </button>
        <button type="button" className="idea-act" disabled={busy} title="Завести задачу — себе или коллеге" onClick={() => onToTask(row)}>
          В работу
        </button>
        <button type="button" className="idea-act" disabled={busy} title="Назначить встречу по этой мысли" onClick={() => onToMeeting(row)}>
          Встреча
        </button>
        <button
          type="button"
          className="idea-act idea-take-act"
          disabled={busy}
          title="Сохранить копию в свои мысли"
          onClick={() => void answer("keep_idea")}
        >
          Сохранить в мысли
        </button>
      </div>
      {error && <div className="send-result">{error}</div>}
    </>
  );
}
