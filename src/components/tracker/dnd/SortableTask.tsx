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
  const { active, over } = useDragState();
  const { setNodeRef } = useDroppable({ id: "col:" + term, data: { target: { kind: "task-column", term } } });

  // Подсвечивается столбец только тогда, когда в него ДЕЙСТВИТЕЛЬНО что-то
  // несут. Подсветка «просто потому, что курсор пролетел мимо» — это ровно
  // тот шум, из-за которого в прежнем виде было не понять, где окажется
  // карточка.
  //
  // Считается по ЦЕЛИ, а не по собственному isOver: целью чаще оказывается
  // карточка внутри столбца, а не столбец сам — и столбец, который при этом
  // не подсвечен, говорит «сюда нельзя» ровно там, где можно.
  const aiming = over?.kind === "task-column" ? over.term === term : over?.kind === "task" ? over.term === term : false;
  const welcoming = aiming && (active?.kind === "task" || active?.kind === "idea");
  // Место, которое раскрывается под то, что несут из другого столбца.
  // Своя задача его не получает: она и так здесь, и её место — силуэт на
  // прежнем месте.
  const showSlot = welcoming && (active?.kind === "idea" || (active?.kind === "task" && active.term !== term));

  return (
    <div ref={setNodeRef} className={"task-column-body" + (welcoming ? " drag-over" : "") + (empty ? " is-empty" : "")}>
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
