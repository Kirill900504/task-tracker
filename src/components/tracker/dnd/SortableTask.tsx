"use client";

// Столбец задач и карточка в нём — та их часть, которая относится к
// перетаскиванию. Вынесено из TasksPanel, потому что панель и без того
// восьмисотстрочная, а здесь нет ничего про задачи: только «этот блок
// можно взять» и «сюда можно положить».

import type { ReactNode } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@/types/tracker";
import type { KanbanColumn } from "@/lib/kanban";
import { useDragState } from "./TrackerDnd";

export type TaskDragProps = {
  ref?: (element: HTMLElement | null) => void;
  style?: CSSProperties;
  attributes?: HTMLAttributes<HTMLElement>;
  listeners?: Record<string, unknown>;
};

export function TaskColumnBody({
  column,
  ids,
  empty,
  children,
}: {
  column: KanbanColumn;
  ids: string[];
  empty: boolean;
  children: ReactNode;
}) {
  const { active, over } = useDragState();
  const { setNodeRef } = useDroppable({ id: "col:" + column, data: { target: { kind: "task-column", column } } });

  // Целится ли человек в ЭТОТ столбец. Подсветки у столбца больше нет
  // вовсе — Кирилл 20.09.2026 попросил убрать «контуры и зонирование», и
  // ответ на «куда встанет» дают расступившиеся соседи, — но знать это
  // по-прежнему нужно: от этого зависит, раскрывать ли место под карточку
  // из другого столбца.
  //
  // Считается по ЦЕЛИ, а не по собственному isOver: целью чаще оказывается
  // карточка внутри столбца, а не столбец сам.
  const aiming = over?.kind === "task-column" ? over.column === column : over?.kind === "task" ? over.column === column : false;
  const welcoming = aiming && (active?.kind === "task" || active?.kind === "idea");
  // Место, которое раскрывается под то, что несут из другого столбца.
  // Своя задача его не получает: она и так здесь, и её место — силуэт на
  // прежнем месте.
  const showSlot = welcoming && (active?.kind === "idea" || (active?.kind === "task" && active.column !== column));

  return (
    <div ref={setNodeRef} className={"task-column-body" + (empty ? " is-empty" : "")}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
      {/* Высота, а не перестановка. Перестановка — это скачок, и глазу
          нечем его проследить; раскрывающееся место читается как «сюда
          поместится», и делает это переходом CSS, без единого перерисованного
          соседа. */}
      <div className={"task-drop-slot" + (showSlot ? " open" : "")} aria-hidden />
    </div>
  );
}

export function SortableTask({
  task,
  column,
  draggable,
  children,
}: {
  task: Task;
  column: KanbanColumn;
  // Чужую задачу перетаскивать нельзя — порядок и срочность её свойства, и
  // база откажет. Запрет стоит ЗДЕСЬ, а не в обработчике сброса: карточка,
  // которая поднимается и не ложится, объясняет ровно столько же, сколько
  // перечёркнутый круг, то есть ничего.
  draggable: boolean;
  children: (dragProps: TaskDragProps, isDragging: boolean) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
    data: { payload: { kind: "task", id: task.id, column }, target: { kind: "task", id: task.id, column } },
    // Соседи расступаются медленнее и мягче, чем по умолчанию (200 мс и
    // резковатая кривая): «перескакивает резко, нервно» — это в том числе
    // про них. Кривая с длинным хвостом выглядит как «отодвинулся», а не
    // как «дёрнулся».
    transition: { duration: 260, easing: "cubic-bezier(.2,.8,.3,1)" },
  });

  const dragProps: TaskDragProps = {
    ref: setNodeRef,
    // Место карточки в столбце остаётся силуэтом (класс .dragging в CSS):
    // сама она в этот момент едет под курсором в DragOverlay, и показывать
    // её дважды нельзя — именно это и выглядело как «почти прозрачная
    // тень», от которой Кирилл отказался.
    style: { transform: CSS.Translate.toString(transform), transition },
    attributes: draggable ? (attributes as HTMLAttributes<HTMLElement>) : undefined,
    listeners: draggable ? (listeners as unknown as Record<string, unknown>) : undefined,
  };

  return <>{children(dragProps, isDragging)}</>;
}
