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
import { useDragState } from "./TrackerDnd";

export type TaskDragProps = {
  ref?: (element: HTMLElement | null) => void;
  style?: CSSProperties;
  attributes?: HTMLAttributes<HTMLElement>;
  listeners?: Record<string, unknown>;
};

export function TaskColumnBody({
  term,
  ids,
  empty,
  children,
}: {
  term: string;
  ids: string[];
  empty: boolean;
  children: ReactNode;
}) {
  const { active } = useDragState();
  const { setNodeRef, isOver } = useDroppable({ id: "col:" + term, data: { target: { kind: "task-column", term } } });

  // Подсвечивается столбец только тогда, когда в него ДЕЙСТВИТЕЛЬНО что-то
  // несут. Подсветка «просто потому, что курсор пролетел мимо» — это ровно
  // тот шум, из-за которого в прежнем виде было не понять, где окажется
  // карточка.
  const welcoming = isOver && (active?.kind === "task" || active?.kind === "idea");

  return (
    <div ref={setNodeRef} className={"task-column-body" + (welcoming ? " drag-over" : "") + (empty ? " is-empty" : "")}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
}

export function SortableTask({
  task,
  term,
  draggable,
  children,
}: {
  task: Task;
  term: string;
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
    data: { payload: { kind: "task", id: task.id, term }, target: { kind: "task", id: task.id, term } },
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
