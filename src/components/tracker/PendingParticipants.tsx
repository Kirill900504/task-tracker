"use client";

import { useState } from "react";
import type { TaskParticipantRole } from "@/lib/taskProgress";
import type { PendingParticipant } from "@/hooks/useTaskParticipants";
import type { PersonOption } from "@/hooks/useTaskParticipants";

// «Кто на задаче» — но до того, как задача существует.
//
// Раньше здесь стояла надпись «можно будет добавить сразу после
// сохранения», и это была честная надпись: строка участия ссылается на
// задачу внешним ключом, а только что созданная задача живёт пока только в
// браузере — вставить участника раньше значит сослаться на несуществующую
// строку и молча его потерять.
//
// Но честная надпись — это всё равно «сделайте это дважды»: сохранить,
// открыть заново, добавить. Задачу на троих ставят одним движением, поэтому
// выбор собирается здесь, в памяти, а строки заводятся сразу после того,
// как задача доедет до базы (см. attachOnCreate в useTaskParticipants).
//
// Роли те же, что и в сохранённой задаче, и означают то же самое: держат
// задачу открытой только исполнители.

const ROLE_LABEL: Record<TaskParticipantRole, string> = {
  executor: "исполнитель",
  coexecutor: "соисполнитель",
  watcher: "наблюдатель",
};

export default function PendingParticipants({
  people,
  primaryName,
  chosen,
  onChange,
}: {
  people: PersonOption[];
  // Имя из поля «Исполнитель» выше: он и так станет исполнителем, поэтому
  // второй раз его не предлагают и в списке он показан отдельно.
  primaryName: string;
  chosen: PendingParticipant[];
  onChange: (next: PendingParticipant[]) => void;
}) {
  const [addWho, setAddWho] = useState("");
  const [addRole, setAddRole] = useState<TaskParticipantRole>("executor");

  const taken = new Set(chosen.map((p) => p.assigneeId));
  const available = people.filter((p) => !taken.has(p.id) && p.name !== primaryName.trim());

  function add() {
    const person = people.find((p) => p.id === addWho);
    if (!person) return;
    onChange([...chosen, { assigneeId: person.id, name: person.name, role: addRole }]);
    setAddWho("");
  }

  return (
    <div className="tp">
      <div className="tp-head">
        <span className="tp-title">Кто на задаче</span>
      </div>

      {primaryName.trim() && (
        <div className="tp-row">
          <span className="tp-name">{primaryName.trim()}</span>
          <span className="tp-role-static">исполнитель</span>
        </div>
      )}

      {chosen.map((p) => (
        <div className="tp-row" key={p.assigneeId}>
          <span className="tp-name">{p.name}</span>
          <select
            className="tp-role"
            value={p.role}
            title="Роль в задаче"
            onChange={(e) =>
              onChange(
                chosen.map((x) => (x.assigneeId === p.assigneeId ? { ...x, role: e.target.value as TaskParticipantRole } : x)),
              )
            }
          >
            {(Object.keys(ROLE_LABEL) as TaskParticipantRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button
            className="btn btn-small tp-remove"
            type="button"
            title="Убрать с задачи"
            onClick={() => onChange(chosen.filter((x) => x.assigneeId !== p.assigneeId))}
          >
            ✕
          </button>
        </div>
      ))}

      {available.length > 0 && (
        <div className="tp-add">
          <select value={addWho} onChange={(e) => setAddWho(e.target.value)}>
            <option value="">— добавить человека —</option>
            {available.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <select value={addRole} onChange={(e) => setAddRole(e.target.value as TaskParticipantRole)}>
            {(Object.keys(ROLE_LABEL) as TaskParticipantRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button className="btn btn-small" type="button" onClick={add} disabled={!addWho}>
            Добавить
          </button>
        </div>
      )}

      <div className="tp-hint">
        Исполнителей может быть несколько — задача закроется, когда отчитается каждый. Соисполнитель помогает, наблюдатель
        только видит.
      </div>
    </div>
  );
}
