"use client";

// Port of the task columns + toolbar from public/legacy-tracker.js
// (render(), matchesFilters(), sortFn/rankOf, the modal open/save/delete
// flow, setupTaskDragDrop()/reorderColumn(), and the idea-drop handlers
// for elListShort/elListLong).
import { useMemo, useRef, useState } from "react";
import type { DragEvent, RefObject } from "react";
import type { Section, Task } from "@/types/tracker";
import { isTaskDueOnDate, taskSortFn } from "@/lib/taskDisplay";
import { getDragAfterElement } from "@/lib/dndDom";
import TaskCard from "./TaskCard";
import TaskModal from "./TaskModal";
import type { useToasts } from "@/hooks/useToasts";
import PanelDragHandle, { resolveDragHandleProps, type PanelDragProps } from "./PanelDragHandle";

type Term = "short" | "long";

export default function TasksPanel({
  tasks,
  sections,
  assignees,
  actions,
  toasts,
  showDone,
  onShowDoneChange,
  calendarFilterDate,
  openTaskRequest,
  onOpenTaskHandled,
  onIdeaDropped,
  justCreatedId,
  notifBanner,
  dragHandleProps,
  isDragging,
  dropIndicatorBefore,
}: {
  tasks: Task[];
  sections: Section[];
  assignees: string[];
  actions: {
    saveTask: (task: Task) => void;
    deleteTask: (id: string) => void;
    restoreTask: (task: Task) => void;
    saveSection: (section: Section) => void;
    deleteSection: (id: string) => void;
    addAssignee: (name: string) => void;
    removeAssignee: (name: string) => void;
  };
  toasts: ReturnType<typeof useToasts>;
  // "Показывать завершённые" is one shared toggle for both done tasks and
  // resolved meetings in the legacy UI (a single checkbox, read by both
  // render() and renderAllMeetings()) — owned by the parent so it can be
  // passed to MeetingsPanel too.
  showDone: boolean;
  onShowDoneChange: (v: boolean) => void;
  calendarFilterDate: string | null;
  openTaskRequest: string | null;
  onOpenTaskHandled: () => void;
  // A dropped idea becomes a task in whichever column it landed on — the
  // idea's own removal/undo is handled by the parent (NewTracker), which
  // owns both tasks and ideas state.
  onIdeaDropped: (ideaId: string, term: Term) => void;
  justCreatedId?: string | null;
  notifBanner?: string | null;
} & PanelDragProps) {
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterSection, setFilterSection] = useState("all");
  const [modalState, setModalState] = useState<{ open: boolean; task: Task | null; presetDeadline?: string }>({ open: false, task: null });

  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ term: Term; beforeId: string | null } | null>(null);
  const [ideaDragOverTerm, setIdeaDragOverTerm] = useState<Term | null>(null);
  const shortColRef = useRef<HTMLDivElement | null>(null);
  const longColRef = useRef<HTMLDivElement | null>(null);

  // A sibling (the calendar's date popover) can also request opening the
  // "new task" modal for a specific date — treated as an alternate open
  // source alongside the internal button-click state, rather than synced
  // into it via an effect (which would cause an extra render pass).
  const modalOpen = modalState.open || openTaskRequest !== null;
  const modalTask = modalState.open ? modalState.task : null;
  const modalPresetDeadline = modalState.open ? modalState.presetDeadline : (openTaskRequest ?? undefined);
  function closeModal() {
    setModalState({ open: false, task: null });
    if (openTaskRequest !== null) onOpenTaskHandled();
  }

  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  const filtered = tasks.filter((t) => {
    if (filterAssignee !== "all" && t.assignee !== filterAssignee) return false;
    if (filterPriority !== "all" && t.priority !== filterPriority) return false;
    if (filterSection !== "all" && (t.sectionId || "") !== filterSection) return false;
    if (calendarFilterDate && !isTaskDueOnDate(t, new Date(calendarFilterDate + "T00:00:00"))) return false;
    return true;
  });
  const shortOpen = filtered.filter((t) => t.term === "short" && t.status !== "done").sort(taskSortFn);
  const longOpen = filtered.filter((t) => t.term === "long" && t.status !== "done").sort(taskSortFn);
  const doneList = filtered
    .filter((t) => t.status === "done")
    .sort((a, b) => {
      const ad = a.deadline || "";
      const bd = b.deadline || "";
      return ad < bd ? 1 : ad > bd ? -1 : 0;
    });

  function toggleDone(t: Task) {
    if (t.status === "done") {
      actions.saveTask({ ...t, status: "in_progress", lastCompletedOn: "" });
    } else {
      actions.saveTask({ ...t, status: "done", lastCompletedOn: new Date().toISOString().slice(0, 10) });
    }
  }

  function deleteTask(t: Task) {
    actions.deleteTask(t.id);
    toasts.showToast("Задача удалена", t.title, () => actions.restoreTask(t));
  }

  // Tasks in the removed section keep their other fields but lose the
  // reference — same as legacy-tracker.js's removeSectionBtn handler, which
  // clears it locally on every affected task rather than leaving a dangling
  // section_id pointing at a row that no longer exists.
  function removeSection(id: string) {
    actions.deleteSection(id);
    tasks.forEach((t) => {
      if (t.sectionId === id) actions.saveTask({ ...t, sectionId: "" });
    });
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, term: Term) {
    if (e.dataTransfer.types.includes("application/x-task-id")) {
      e.preventDefault();
      const container = term === "short" ? shortColRef.current : longColRef.current;
      const after = container ? getDragAfterElement(container, e.clientY, ".task:not(.dragging)") : null;
      setDropIndicator({ term, beforeId: after?.dataset.id ?? null });
    } else if (e.dataTransfer.types.includes("application/x-idea-id")) {
      e.preventDefault();
      setIdeaDragOverTerm(term);
    }
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>, term: Term) {
    const container = term === "short" ? shortColRef.current : longColRef.current;
    if (container && !container.contains(e.relatedTarget as Node)) {
      setDropIndicator((cur) => (cur?.term === term ? null : cur));
      setIdeaDragOverTerm((cur) => (cur === term ? null : cur));
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, term: Term) {
    e.preventDefault();
    const ideaId = e.dataTransfer.getData("application/x-idea-id");
    if (ideaId) {
      setIdeaDragOverTerm(null);
      onIdeaDropped(ideaId, term);
      return;
    }
    const taskId = e.dataTransfer.getData("application/x-task-id");
    setDropIndicator(null);
    if (!taskId) return;
    const dragged = tasks.find((t) => t.id === taskId);
    if (!dragged) return;

    const container = term === "short" ? shortColRef.current : longColRef.current;
    const after = container ? getDragAfterElement(container, e.clientY, ".task:not(.dragging)") : null;
    const columnList = term === "short" ? shortOpen : longOpen;
    const siblingIds = columnList.filter((t) => t.id !== taskId).map((t) => t.id);
    const insertAt = after ? siblingIds.indexOf(after.dataset.id as string) : -1;
    siblingIds.splice(insertAt === -1 ? siblingIds.length : insertAt, 0, taskId);

    siblingIds.forEach((id, i) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      const changedTerm = id === taskId && t.term !== term;
      if (t.manualOrder === i && !changedTerm) return;
      actions.saveTask({ ...t, manualOrder: i, ...(changedTerm ? { term } : {}) });
    });
  }

  function renderColumn(list: Task[], emptyText: string, countLabel: string, term: Term, ref: RefObject<HTMLDivElement | null>) {
    return (
      <div className="column">
        <div className="section-title">
          {countLabel} <span className="count">{list.length}</span>
        </div>
        <div
          ref={ref}
          className={ideaDragOverTerm === term ? "drag-over" : dropIndicator?.term === term && dropIndicator.beforeId === null ? "drag-indicator-end" : ""}
          onDragOver={(e) => handleDragOver(e, term)}
          onDragLeave={(e) => handleDragLeave(e, term)}
          onDrop={(e) => handleDrop(e, term)}
        >
          {list.length === 0 ? (
            <div className="empty">{emptyText}</div>
          ) : (
            list.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                section={sectionById.get(t.sectionId) ?? null}
                onToggleDone={() => toggleDone(t)}
                onOpen={() => setModalState({ open: true, task: t })}
                isDragging={draggingTaskId === t.id}
                justCreated={justCreatedId === t.id}
                dropIndicatorBefore={dropIndicator?.term === term && dropIndicator.beforeId === t.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-task-id", t.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingTaskId(t.id);
                }}
                onDragEnd={() => {
                  setDraggingTaskId(null);
                  setDropIndicator(null);
                }}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={"main-col dash-panel" + (isDragging ? " dragging" : "") + (dropIndicatorBefore ? " drag-indicator" : "")} id="mainCol" data-panel-id="mainCol">
      <div className="dash-panel-head">
        <PanelDragHandle {...resolveDragHandleProps(dragHandleProps)} />
        <div className="panel-title">Задачи</div>
      </div>
      {notifBanner && <div className="notif-banner show">{notifBanner}</div>}
      <div className="toolbar">
        <button className="btn btn-primary" id="newTaskBtn" onClick={() => setModalState({ open: true, task: null })}>
          + Новая задача
        </button>
        <select id="filterSection" value={filterSection} onChange={(e) => setFilterSection(e.target.value)}>
          <option value="all">Все разделы</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select id="filterAssignee" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
          <option value="all">Все исполнители</option>
          {assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select id="filterPriority" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
          <option value="all">Любой приоритет</option>
          <option value="high">Высокий</option>
          <option value="med">Средний</option>
        </select>
        <label className="check-wrap">
          <input type="checkbox" id="showDoneCheckbox" checked={showDone} onChange={(e) => onShowDoneChange(e.target.checked)} /> Показывать завершённые
        </label>
      </div>

      <div className="columns">
        {renderColumn(shortOpen, "Нет краткосрочных задач по текущим фильтрам", "Краткосрочные", "short", shortColRef)}
        {renderColumn(longOpen, "Нет долгосрочных задач по текущим фильтрам", "Долгосрочные", "long", longColRef)}
      </div>

      {showDone && (
        <div className="done-wrap" id="doneWrap">
          <div className="section-title">
            Завершённые <span className="count">{doneList.length}</span>
          </div>
          <div>
            {doneList.length === 0 ? (
              <div className="empty">Нет завершённых задач по текущим фильтрам</div>
            ) : (
              doneList.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  section={sectionById.get(t.sectionId) ?? null}
                  onToggleDone={() => toggleDone(t)}
                  onOpen={() => setModalState({ open: true, task: t })}
                />
              ))
            )}
          </div>
        </div>
      )}

      {modalOpen && (
        <TaskModal
          key={modalTask?.id ?? "new"}
          task={modalTask}
          presetDeadline={modalPresetDeadline}
          sections={sections}
          assignees={assignees}
          onSave={actions.saveTask}
          onDelete={() => modalTask && deleteTask(modalTask)}
          onClose={closeModal}
          onAddAssignee={actions.addAssignee}
          onRemoveAssignee={actions.removeAssignee}
          onAddSection={actions.saveSection}
          onRemoveSection={removeSection}
        />
      )}
    </div>
  );
}
