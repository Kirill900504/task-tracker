"use client";

import { useState } from "react";
import Icon from "./Icon";
import { useSlotVotes } from "@/hooks/useSlotVotes";
import { slotLabel, type SlotOption } from "@/lib/meetingPollRules";
import { withoutSelfMark } from "@/lib/actorName";

// Варианты времени у встречи-опроса (миграция 0062, lib/meetingPoll).
//
// Участник отмечает, какие варианты ему подходят (можно несколько, можно
// снять), организатор видит, сколько и кому подходит каждый, и может
// назначить вариант сам, не дожидаясь всех. Когда ответили все, встречу
// назначает сервер — вариант, подходящий большинству и свободный у всех.
export default function MeetingPoll({
  meetingId,
  options,
  myAssigneeId,
  canVote,
  isOrganizer,
  names,
  onScheduled,
}: {
  meetingId: string;
  options: SlotOption[];
  myAssigneeId: string;
  canVote: boolean;
  isOrganizer: boolean;
  // Кто есть кто: id строки → имя (из голосов «буду» этой встречи).
  names: Record<string, string>;
  onScheduled: (when: string) => void;
}) {
  const { votes, reload } = useSlotVotes(meetingId, true);
  const mineFromServer = votes.find((v) => v.assigneeId === myAssigneeId)?.slots;
  const [mine, setMine] = useState<number[] | null>(null);
  const picked = mine ?? mineFromServer ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/workspace/slot-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; scheduled?: string };
      if (!res.ok) throw new Error(data.error || "Не получилось");
      if (data.scheduled) onScheduled(data.scheduled);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMine(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="poll-block" id="meetingPoll">
      <div className="desc-head">
        <span className="fact-label">Варианты времени</span>
        <span className="checklist-count">
          ответили {votes.length}
        </span>
      </div>
      <p className="field-hint poll-hint">
        {canVote
          ? "Отметьте все варианты, которые вам подходят. Когда ответят все, встреча назначится на тот, что подходит большинству."
          : "Участники отмечают удобные варианты. Когда ответят все, встреча назначится сама — или назначьте вариант сейчас."}
      </p>
      <ul className="poll-list">
        {options.map((o, i) => {
          const fits = votes.filter((v) => v.slots.includes(i));
          const on = picked.includes(i);
          return (
            <li className="poll-row" key={i} data-slot={i}>
              <span className="poll-when">{slotLabel(o)}</span>
              <span className="poll-fits" title={fits.map((v) => withoutSelfMark(names[v.assigneeId] || "")).filter(Boolean).join(", ") || "Пока никому"}>
                <Icon name="users" size={13} /> {fits.length}
              </span>
              {canVote && (
                <button
                  type="button"
                  className={"participant-chip poll-pick" + (on ? " selected" : "")}
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => {
                    const next = on ? picked.filter((x) => x !== i) : [...picked, i].sort((a, b) => a - b);
                    setMine(next);
                    void send({ slots: next });
                  }}
                >
                  {on ? "✓ Подходит" : "Подходит?"}
                </button>
              )}
              {isOrganizer && (
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => void send({ choose: i })}>
                  Назначить
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {canVote && !mineFromServer && mine === null && (
        <button type="button" className="btn btn-small poll-none" disabled={busy} onClick={() => void send({ slots: [] })}>
          Не подходит ни один
        </button>
      )}
      {error && <div className="ms-answer-error">{error}</div>}
    </div>
  );
}
