"use client";

import { useState } from "react";
import type { DragEvent } from "react";
import type { Section, Task } from "@/types/tracker";
import { fmtDate, isDueTodayHighlight, isOverdue, priorityClass, priorityLabel, recurLabel } from "@/lib/taskDisplay";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSwipeComplete } from "@/hooks/useSwipeComplete";
import ActionMenu, { type ActionMenuItem } from "./ActionMenu";

export default function TaskCard({
  task,
  section,
  onToggleDone,
  onOpen,
  isDragging,
  onDragStart,
  onDragEnd,
  justCreated,
  dropIndicatorBefore,
  menuItems,
}: {
  task: Task;
  section: Section | null;
  onToggleDone: () => void;
  onOpen: () => void;
  isDragging?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
  justCreated?: boolean;
  dropIndicatorBefore?: boolean;
  // Everything the card can do that a mouse would do by dragging it —
  // moving it up the column, sending it to the other column, turning it into
  // a meeting. Shown only on a phone: with a mouse the drag is still there
  // and is faster.
  menuItems?: ActionMenuItem[];
}) {
  const isMobile = useIsMobile();
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null);
  // Finishing something is the action of the day — on a phone it is a
  // swipe to the right, and reopening it is the same swipe again.
  const swipe = useSwipeComplete(onToggleDone, isMobile);

  const overdue = isOverdue(task);
  const dueToday = !overdue && isDueTodayHighlight(task);

  const card = (
    <div
      className={
        "task" +
        (task.status === "done" ? " done" : "") +
        (task.priority === "high" ? " high" : "") +
        (overdue ? " overdue" : "") +
        (dueToday ? " due-today" : "") +
        (isDragging ? " dragging" : "") +
        (justCreated ? " just-created" : "") +
        (dropIndicatorBefore ? " drag-indicator" : "")
      }
      data-id={task.id}
      style={swipe.offset ? { transform: `translateX(${swipe.offset}px)`, transition: "none" } : undefined}
      {...swipe.handlers}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      <div
        className={"check" + (task.status === "done" ? " checked" : "")}
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
      >
        {task.status === "done" ? "✓" : ""}
      </div>
      <div className="task-body">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {section && <span className={"pill pill-section" + (section.kind === "personal" ? " pill-section-personal" : "")}>{section.name}</span>}
          {task.assignee && (
            <div className="task-assignee">
              <span className="arrow">→</span>
              {task.assignee}
            </div>
          )}
          {task.deadline && (
            <span className={"pill pill-date" + (overdue ? " overdue-text" : "") + (dueToday ? " due-today-text" : "")}>
              {(overdue ? "⚠ Просрочено: " : dueToday ? "● Сегодня: " : "до ") + fmtDate(task.deadline)}
            </span>
          )}
          {!task.deadline && task.recur !== "none" && isDueTodayHighlight(task) && <span className="pill pill-date due-today-text">● Выполнить сегодня</span>}
          <span className={"pill " + priorityClass(task.priority)}>{priorityLabel(task.priority)}</span>
          {recurLabel(task) && <span className="pill pill-recur">{recurLabel(task)}</span>}
          {/* Pressed «Принял» in Telegram — the answer to «взял в работу?»,
              without having to ask. Dropped once the task is done, where it
              would only be noise. */}
          {task.acceptedAt && task.status !== "done" && <span className="pill pill-accepted">✅ принял</span>}
        </div>
      </div>
      {isMobile && !!menuItems?.length && (
        <button
          className="task-menu-btn"
          title="Действия"
          data-task-menu={task.id}
          onClick={(e) => {
            e.stopPropagation();
            setMenuAt(e.currentTarget.getBoundingClientRect());
          }}
        >
          ⋮
        </button>
      )}
      {menuAt && !!menuItems?.length && <ActionMenu anchor={menuAt} title={task.title} items={menuItems} onClose={() => setMenuAt(null)} />}
    </div>
  );

  if (!isMobile) return card;

  // The swipe hint lives behind the card, so it appears from under it as
  // the card slides.
  return (
    <div className={"swipe-wrap" + (swipe.armed ? " armed" : "")}>
      <div className="swipe-hint">{task.status === "done" ? "↩ вернуть" : "✓ готово"}</div>
      {card}
    </div>
  );
}
