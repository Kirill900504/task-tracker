"use client";

import { useState } from "react";
import ActionMenu from "./ActionMenu";
import type { TaskParticipantRole } from "@/lib/taskProgress";
import type { PersonOption } from "@/hooks/useTaskParticipants";

// Кто на задаче — одним полем.
//
// Раньше их было два, и они спрашивали почти одно и то же: «Исполнитель»
// выпадающим списком (плюс «+» и «−» рядом) и «Кто на задаче» — выбрать
// человека, выбрать роль, нажать «Добавить». Три действия на каждого, два
// разных места для одного вопроса и постоянная путаница, чем первое
// отличается от второго. Кирилл попросил одно поле, и он прав: вопрос
// действительно один — кто это делает.
//
// Люди стоят кнопками, как участники встречи: вся команда видна сразу и
// выбирается одним касанием. Роль спрашивается следом, маленьким меню у
// самой кнопки — тем же, каким календарь спрашивает «задача или встреча»
// при щелчке по дате. На телефоне это меню само становится полосой у
// нижнего края (см. ActionMenu), так что выбор роли не превращается в
// попадание пальцем в строку выпадающего списка.
//
// Исполнитель по умолчанию: девять задач из десяти ставятся одному человеку
// и без ролей, поэтому первое нажатие ставит исполнителя сразу, а меню
// открывается уже у выбранного — чтобы поменять роль или убрать.

export type PickedPerson = { id: string; name: string; role: TaskParticipantRole };

const ROLE_LABEL: Record<TaskParticipantRole, string> = {
  executor: "исполнитель",
  coexecutor: "соисполнитель",
  watcher: "наблюдатель",
};

const ROLE_MENU: { role: TaskParticipantRole; label: string }[] = [
  { role: "executor", label: "Исполнитель — отчитывается сам" },
  { role: "coexecutor", label: "Соисполнитель — помогает" },
  { role: "watcher", label: "Наблюдатель — только видит" },
];

export default function PeoplePicker({
  people,
  picked,
  onPick,
  onRemove,
  onAddPerson,
  onDeletePerson,
}: {
  people: PersonOption[];
  picked: PickedPerson[];
  onPick: (person: PersonOption, role: TaskParticipantRole) => void;
  onRemove: (person: PickedPerson) => void;
  // «Человека нет в списке» — тот же вопрос, что раньше задавала кнопка «+»
  // рядом с выпадающим списком.
  onAddPerson?: () => void;
  // А это бывшая кнопка «−»: удалить человека из списка людей вообще. Живёт
  // в меню, а не рядом с именами: её нажимают раз в полгода, а стоя рядом с
  // «убрать с задачи» она читалась бы как то же самое.
  onDeletePerson?: (person: PersonOption) => void;
}) {
  const [menuFor, setMenuFor] = useState<{ person: PersonOption; anchor: DOMRect } | null>(null);
  const roleOf = (id: string) => picked.find((p) => p.id === id)?.role;

  return (
    <div className="field people-field">
      <label>Кто на задаче</label>
      <div className="participant-grid" id="fPeople">
        {people.map((person) => {
          const role = roleOf(person.id);
          return (
            <button
              key={person.id}
              type="button"
              className={"participant-chip" + (role ? " selected role-" + role : "")}
              onClick={(e) => {
                // Первое нажатие — сразу исполнитель, без лишнего вопроса.
                // Меню открывается только у того, кто уже выбран: тогда речь
                // о роли и о том, чтобы убрать.
                if (!role) onPick(person, "executor");
                else setMenuFor({ person, anchor: e.currentTarget.getBoundingClientRect() });
              }}
              title={role ? `${person.name} — ${ROLE_LABEL[role]}` : `Поставить на задачу: ${person.name}`}
            >
              {person.name}
              {role && role !== "executor" && <span className="chip-role"> · {ROLE_LABEL[role]}</span>}
            </button>
          );
        })}
        {onAddPerson && (
          <button type="button" className="participant-chip chip-add" id="addAssigneeBtn" onClick={onAddPerson}>
            + человек
          </button>
        )}
      </div>

      <div className="tp-hint">
        Исполнителей может быть несколько — задача закроется, когда отчитается каждый. Соисполнитель помогает, наблюдатель
        только видит. Нажмите на выбранного, чтобы сменить роль или убрать.
      </div>

      {menuFor && (
        <ActionMenu
          anchor={menuFor.anchor}
          title={menuFor.person.name}
          items={[
            ...ROLE_MENU.filter((r) => r.role !== roleOf(menuFor.person.id)).map((r) => ({
              id: r.role,
              label: r.label,
              onSelect: () => onPick(menuFor.person, r.role),
            })),
            {
              id: "remove",
              label: "✕ Убрать с задачи",
              onSelect: () => {
                const current = picked.find((p) => p.id === menuFor.person.id);
                if (current) onRemove(current);
              },
            },
            ...(onDeletePerson
              ? [
                  {
                    id: "delete",
                    label: "🗑 Удалить из списка людей",
                    onSelect: () => onDeletePerson(menuFor.person),
                  },
                ]
              : []),
          ]}
          onClose={() => setMenuFor(null)}
        />
      )}
    </div>
  );
}
