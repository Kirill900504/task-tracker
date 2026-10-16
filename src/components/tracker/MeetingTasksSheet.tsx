"use client";

import { useState } from "react";
import Modal from "./Modal";
import ItemModalHead from "./ItemModalHead";
import Dropdown from "./Dropdown";
import { withoutSelfMark } from "@/lib/actorName";
import { isoDate, workdayIn } from "@/lib/whenDate";
import { defaultDeadline } from "@/lib/newTask";

// Поручения из итога встречи — одним окном.
//
// Предложение 4 от 13.10.2026, одобрено 14.10.2026: «итог встречи одной
// кнопкой превращается в задачи с исполнителями сразу, без
// перепечатывания». До этого после «Успеха» трекер предлагал ОДНУ задачу
// с итогом целиком в названии — а на планёрке договариваются о трёх-пяти
// делах разным людям, и остальные четыре не заводились никогда.
//
// Пункты — это ПОВЕСТКА встречи, а не итог, порезанный на строки
// (16.10.2026, его слова: «предлагай к постановке задачей повестки, а не
// итоговое описание»). Итог — свободный текст, и резать его на задачи
// значило получать задачи из обрывков фраз; пункт повестки же уже
// сформулирован как дело, а «что решили» по нему уходит в описание задачи.
// Ничего не создаётся молча: каждый пункт показан, у него выбирают
// человека и срок, лишнее снимают галочкой — и только потом «Поставить».
// Отказаться целиком — своей кнопкой «Не ставить задачей»: окно всплывает
// само после «Успех / Провал», и выход из него обязан быть словом рядом с
// «Поставить», а не только крестиком в углу. Срок обязателен
// (14.10.2026) — по умолчанию неделя, как везде.
export type RecapItem = { title: string; note: string };
export type RecapTask = RecapItem & { assignee: string; deadline: string };

type Row = RecapTask & { on: boolean };

const QUICK = [
  { label: "Завтра", days: 1 },
  { label: "Неделя", days: 7 },
  { label: "Две недели", days: 14 },
];

export default function MeetingTasksSheet({
  meetingTitle,
  items,
  people,
  onCreate,
  onClose,
}: {
  meetingTitle: string;
  items: RecapItem[];
  // Кого можно назначить: участники встречи и организатор.
  people: string[];
  onCreate: (tasks: RecapTask[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    items.map(({ title, note }) => ({ title, note, assignee: people[0] || "", deadline: defaultDeadline(), on: true })),
  );
  const chosen = rows.filter((r) => r.on && r.title.trim() && r.assignee);
  const set = (i: number, patch: Partial<Row>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Modal onClose={onClose} dismissOnBackdrop={false}>
      <div className="modal recap-tasks" id="recapTasksSheet">
        <ItemModalHead title="Задачи из повестки" kicker={`Встреча «${meetingTitle}»`} plain onClose={onClose} closeId="recapTasksClose" />
        <div className="recap-rows">
          {rows.map((r, i) => (
            <div className={"recap-row" + (r.on ? "" : " off")} key={i}>
              <button type="button" className={"check" + (r.on ? " checked" : "")} aria-pressed={r.on} title={r.on ? "Не ставить" : "Поставить"} onClick={() => set(i, { on: !r.on })}>
                {r.on ? "✓" : ""}
              </button>
              <div className="recap-main">
                <input className="recap-title" value={r.title} maxLength={200} onChange={(e) => set(i, { title: e.target.value })} aria-label="Что сделать" />
                {r.note && <div className="recap-note">Решили: {r.note}</div>}
                <div className="recap-meta">
                  <Dropdown
                    compact
                    value={r.assignee}
                    onChange={(v) => set(i, { assignee: v })}
                    options={people.map((p) => ({ value: p, label: withoutSelfMark(p) }))}
                  />
                  {QUICK.map((q) => {
                    const iso = isoDate(workdayIn(new Date(), q.days));
                    return (
                      <button
                        key={q.label}
                        type="button"
                        className={"participant-chip" + (r.deadline === iso ? " selected" : "")}
                        onClick={() => set(i, { deadline: iso })}
                      >
                        {q.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <div className="left" />
          <div className="left">
            <button type="button" className="btn" id="recapTasksSkip" onClick={onClose}>
              Не ставить задачей
            </button>
            <button
              type="button"
              className="btn btn-primary"
              id="recapTasksCreate"
              disabled={!chosen.length}
              onClick={() => {
                onCreate(chosen.map(({ title, note, assignee, deadline }) => ({ title: title.trim(), note, assignee, deadline })));
                onClose();
              }}
            >
              Поставить {chosen.length} {chosen.length === 1 ? "задачу" : chosen.length >= 2 && chosen.length <= 4 ? "задачи" : "задач"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
