"use client";

import { useMemo } from "react";
import type { Task } from "@/types/tracker";
import { peopleLoad } from "@/lib/peoplePanel";
import PanelDragHandle, { resolveDragHandleProps, type PanelDragProps } from "./PanelDragHandle";

// «Люди» — кто чем занят, строкой на человека.
//
// Самое крупное, чего в трекере не было: четырнадцать человек, и узнать, у
// кого что, можно было только фильтром по одному. Понедельничная сводка
// отвечает на тот же вопрос раз в неделю и в мессенджере, а задают его
// каждый день и глядя в трекер.
//
// Строка — кнопка: нажатие ставит фильтр по этому человеку, повторное
// снимает. Это и есть ответ на «а что там у Игоря»: не отдельный экран, а
// тот же список задач, суженный до него.

export default function PeoplePanel({
  tasks,
  assignees,
  selected,
  onSelect,
  dragHandleProps,
  isDragging,
}: {
  tasks: Task[];
  assignees: string[];
  // Имя выбранного человека или "all".
  selected: string;
  onSelect: (name: string) => void;
} & PanelDragProps) {
  const rows = useMemo(() => peopleLoad(tasks, assignees), [tasks, assignees]);

  return (
    <div
      className={"panel dash-panel" + (isDragging ? " dragging" : "")}
      data-panel-id="peoplePanel"
    >
      <div className="dash-panel-head">
        <PanelDragHandle {...resolveDragHandleProps(dragHandleProps)} />
        <h2 className="panel-title">
          Люди <span className="count">{rows.length}</span>
        </h2>
      </div>

      {!rows.length && <div className="empty">Никому ничего не поручено.</div>}

      {rows.map((p) => (
        <button
          key={p.name}
          type="button"
          className={"people-row" + (selected === p.name ? " selected" : "")}
          title={selected === p.name ? "Показать снова все задачи" : `Показать только задачи: ${p.name}`}
          onClick={() => onSelect(selected === p.name ? "all" : p.name)}
        >
          <span className="people-name">{p.name}</span>
          <span className="people-nums">
            {/* Порядок цифр — по тому, о чём спрашивают раньше. Ноль не
                рисуется вовсе: четырнадцать строк по четыре нуля читаются
                как таблица, в которой нечего искать. */}
            {p.overdue > 0 && <span className="people-num bad" title="Просрочено">⚠ {p.overdue}</span>}
            {p.silent > 0 && <span className="people-num warn" title="Не ответил ничего">🔕 {p.silent}</span>}
            {p.review > 0 && <span className="people-num ok" title="Сдал, ждёт вашей приёмки">◍ {p.review}</span>}
            <span className="people-num" title="В работе">{p.open}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
