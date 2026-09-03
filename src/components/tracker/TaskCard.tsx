"use client";

import type { DragEvent } from "react";
import type { Section, Task } from "@/types/tracker";
import { fmtDate, isDueTodayHighlight, isOverdue, priorityClass, priorityLabel, recurLabel } from "@/lib/taskDisplay";

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
}) {
  const overdue = isOverdue(task);
  const dueToday = !overdue && isDueTodayHighlight(task);

  return (
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
        </div>
      </div>
    </div>
  );
}
