"use client";

import { useState } from "react";
import Modal from "./Modal";
import ItemModalHead from "./ItemModalHead";
import Icon from "./Icon";
import type { PersonOption } from "@/hooks/useTaskParticipants";
import type { TaskParticipantRole } from "@/lib/taskProgress";
import { sortByPeopleOrder } from "@/lib/peopleOrder";
import { withoutSelfMark } from "@/lib/actorName";
import { useIsMobile } from "@/hooks/useIsMobile";
import { colorOf, initialsOf } from "@/lib/personBadge";

// «+» в сводке задачи: кого добавить и кем.
//
// Слова Кирилла 13.10.2026: «добавить небольшую кнопочку „+“, чтобы была
// возможность добавить дополнительных людей в задачу и их роль (должна
// всплывать удобная и упорядоченная форма для выбора человека поверх окна
// задачи)». Раньше это были два меню подряд — «кого» списком и «кем» вторым
// списком у того же места, — то есть два вопроса там, где хватает одной
// строки: человек и три кнопки роли рядом с ним. Нажали роль — он на
// задаче, окно остаётся открытым для следующего: людей обычно добавляют
// по двое-трое.
//
// Порядок — общий для всех списков людей (lib/peopleOrder). Список не
// обрезается: обрез в списке ЛЮДЕЙ — всегда ошибка (см. CLAUDE.md,
// «показывает не всех»).

const ROLES: { role: TaskParticipantRole; label: string; title: string }[] = [
  { role: "executor", label: "Исполнитель", title: "Отвечает за результат и отчитывается сам" },
  { role: "coexecutor", label: "Соисполнитель", title: "Помогает исполнителю" },
  { role: "watcher", label: "Наблюдатель", title: "Только видит задачу и обсуждение" },
];

export default function AddPeopleSheet({
  people,
  onAdd,
  onAddPerson,
  onClose,
}: {
  // Кого на задаче ещё нет.
  people: PersonOption[];
  onAdd: (person: PersonOption, role: TaskParticipantRole) => void;
  // Завести нового человека — только у администратора.
  onAddPerson?: () => void;
  onClose: () => void;
}) {
  // Поиска печатанием нет нигде (14.10.2026, «кнопками указывать будем
  // кого надо») — только список людей целиком. На телефоне нет и «Нового
  // человека», как в форме новой задачи (PeoplePicker).
  const isMobile = useIsMobile();
  // Только что добавленные исчезают из списка сразу, не дожидаясь, пока
  // строка участия вернётся из базы: иначе второе нажатие по тому же
  // человеку выглядело бы как «не сработало».
  const [added, setAdded] = useState<Record<string, TaskParticipantRole>>({});
  const roleWord = (r: TaskParticipantRole) => ROLES.find((x) => x.role === r)!.label.toLowerCase();

  const list = sortByPeopleOrder(people, (p) => p.name);
  const justAdded = Object.entries(added);

  return (
    <Modal onClose={onClose} className="add-people-overlay">
      <div className="modal add-people" id="addPeopleSheet">
        <ItemModalHead plain title="Добавить в задачу" onClose={onClose} />
        {justAdded.length > 0 && (
          <div className="add-people-done">
            Добавлены:{" "}
            {justAdded.map(([id, role]) => {
              const p = people.find((x) => x.id === id);
              return p ? <span key={id}>{withoutSelfMark(p.name)} ({roleWord(role)}) </span> : null;
            })}
          </div>
        )}

        <div className="add-people-list">
          {list
            .filter((p) => !added[p.id])
            .map((p) => (
              <div className="add-people-row" key={p.id} data-person={withoutSelfMark(p.name)}>
                <span className="add-people-name">
                  <span className="pbadge-dot" style={{ background: colorOf(withoutSelfMark(p.name)) }} aria-hidden>
                    {initialsOf(p.name)}
                  </span>
                  <span className="add-people-label">{withoutSelfMark(p.name)}</span>
                </span>
                <span className="add-people-roles">
                  {ROLES.map((r) => (
                    <button
                      key={r.role}
                      type="button"
                      className={"participant-chip role-pick role-pick-" + r.role}
                      title={r.title}
                      onClick={() => {
                        setAdded((prev) => ({ ...prev, [p.id]: r.role }));
                        onAdd(p, r.role);
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          {list.filter((p) => !added[p.id]).length === 0 && (
            <div className="add-people-empty">Все уже на задаче.</div>
          )}
        </div>

        {onAddPerson && !isMobile && (
          <button type="button" className="btn btn-small add-people-new" onClick={onAddPerson}>
            <Icon name="plus" size={14} /> Новый человек
          </button>
        )}
      </div>
    </Modal>
  );
}
