"use client";

// Port of the task columns + toolbar from public/legacy-tracker.js
// (render(), matchesFilters(), sortFn/rankOf, the modal open/save/delete
// flow, setupTaskDragDrop()/reorderColumn(), and the idea-drop handlers
// for elListShort/elListLong).
import { useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode, RefObject } from "react";
import type { Section, Task, TaskPrefill } from "@/types/tracker";
import { isTaskDueOnDate, taskSortFn } from "@/lib/taskDisplay";
import { getDragAfterElement } from "@/lib/dndDom";
import TaskCard from "./TaskCard";
import type { ActionMenuItem } from "./ActionMenu";
import TaskModal from "./TaskModal";
import SendMenu from "./SendMenu";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useTaskParticipants } from "@/hooks/useTaskParticipants";
import { progressLabel, taskStage } from "@/lib/taskProgress";
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
  openExistingTaskId,
  onOpenExistingHandled,
  onIdeaDropped,
  onTaskToMeeting,
  justCreatedId,
  notifBanner,
  extraBanner,
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
  openTaskRequest: TaskPrefill | null;
  onOpenTaskHandled: () => void;
  // The global search asking for this task's card to be opened. Separate
  // from openTaskRequest, which prefills a NEW task.
  openExistingTaskId?: string | null;
  onOpenExistingHandled?: () => void;
  // A dropped idea becomes a task in whichever column it landed on — the
  // idea's own removal/undo is handled by the parent (NewTracker), which
  // owns both tasks and ideas state.
  onIdeaDropped: (ideaId: string, term: Term) => void;
  // «Назначить встречу» from a card's menu — the phone's version of
  // dragging the task onto a calendar day.
  onTaskToMeeting?: (taskId: string) => void;
  justCreatedId?: string | null;
  notifBanner?: string | null;
  // Rendered under the notification banner, in the same slot legacy's
  // #syncErrorBanner occupied (see SyncErrorBanner).
  extraBanner?: ReactNode;
} & PanelDragProps) {
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterSection, setFilterSection] = useState("all");
  const [modalState, setModalState] = useState<{ open: boolean; task: Task | null; prefill?: TaskPrefill }>({ open: false, task: null });
  const isMobile = useIsMobile();
  // Кто на задаче — один слой на всю панель: и карточки, и форма
  // читают отсюда, чтобы не заводить по подписке на каждую карточку.
  const participants = useTaskParticipants();
  // On a phone the four filter controls cost a third of the screen before
  // a single task is visible, and most days none of them is touched — so
  // they fold away, with a dot on the button when any is actually set.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Collapsible columns, persisted per column exactly like legacy did
  // (localStorage key kkt_collapsed_<colId>) so the choice survives reloads.
  const [collapsedCols, setCollapsedCols] = useState<Record<string, boolean>>(() => {
    const empty: Record<string, boolean> = {};
    if (typeof localStorage === "undefined") return empty;
    try {
      return { colShort: localStorage.getItem("kkt_collapsed_colShort") === "1", colLong: localStorage.getItem("kkt_collapsed_colLong") === "1" };
    } catch {
      return empty;
    }
  });
  function toggleCollapsed(colId: string) {
    setCollapsedCols((cur) => {
      const next = { ...cur, [colId]: !cur[colId] };
      try {
        localStorage.setItem("kkt_collapsed_" + colId, next[colId] ? "1" : "0");
      } catch {
        /* private mode / storage disabled — the toggle still works for this session */
      }
      return next;
    });
  }

  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  // The card whose «кому отправить» menu is open (phone only — with a
  // mouse the same thing sits in the task's own form).
  const [sendTask, setSendTask] = useState<Task | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ term: Term; beforeId: string | null } | null>(null);
  const [ideaDragOverTerm, setIdeaDragOverTerm] = useState<Term | null>(null);
  const shortColRef = useRef<HTMLDivElement | null>(null);
  const longColRef = useRef<HTMLDivElement | null>(null);

  // A sibling (the calendar's date popover) can also request opening the
  // "new task" modal for a specific date — treated as an alternate open
  // source alongside the internal button-click state, rather than synced
  // into it via an effect (which would cause an extra render pass).
  // The card the global search asked for, worked out during render rather
  // than pushed into state by an effect — same shape as openTaskRequest.
  const requestedTask = openExistingTaskId ? (tasks.find((t) => t.id === openExistingTaskId) ?? null) : null;

  const modalOpen = modalState.open || openTaskRequest !== null || requestedTask !== null;
  const modalTask = modalState.open ? modalState.task : requestedTask;
  const modalPrefill = modalState.open ? modalState.prefill : (openTaskRequest ?? undefined);
  function closeModal() {
    setModalState({ open: false, task: null });
    if (openTaskRequest !== null) onOpenTaskHandled();
    if (openExistingTaskId) onOpenExistingHandled?.();
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
  // Most recently completed first — this list exists to reopen what was just
  // closed, so closing order beats deadline order. Tasks closed before
  // completedAt existed have no timestamp; they fall back to deadline and
  // sort below everything that does have one.
  const doneList = filtered
    .filter((t) => t.status === "done")
    .sort((a, b) => {
      const ac = a.completedAt || "";
      const bc = b.completedAt || "";
      if (ac !== bc) return ac > bc ? -1 : 1;
      const ad = a.deadline || "";
      const bd = b.deadline || "";
      return ad < bd ? 1 : ad > bd ? -1 : 0;
    });

  function toggleDone(t: Task) {
    if (t.status === "done") {
      actions.saveTask({ ...t, status: "in_progress", lastCompletedOn: "", completedAt: "" });
    } else {
      // completedAt is what orders the "завершённые" list newest-first, so
      // the task just closed is the one at the top, ready to be reopened.
      actions.saveTask({ ...t, status: "done", lastCompletedOn: new Date().toISOString().slice(0, 10), completedAt: new Date().toISOString() });
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

  // Ordering by hand is a drag with a mouse, and a finger has no drag at
  // all. Renumbering the whole column is exactly what handleDrop does, so
  // both routes leave manualOrder in the same shape.
  function moveWithinColumn(t: Task, to: "top" | "bottom") {
    const others = (t.term === "short" ? shortOpen : longOpen).filter((x) => x.id !== t.id).map((x) => x.id);
    const ids = to === "top" ? [t.id, ...others] : [...others, t.id];
    ids.forEach((id, i) => {
      const task = tasks.find((x) => x.id === id);
      if (!task || task.manualOrder === i) return;
      actions.saveTask({ ...task, manualOrder: i });
    });
  }

  function menuItemsFor(t: Task): ActionMenuItem[] {
    const items: ActionMenuItem[] = [
      { id: "top", label: "⬆ Наверх списка", onSelect: () => moveWithinColumn(t, "top") },
      { id: "bottom", label: "⬇ В конец списка", onSelect: () => moveWithinColumn(t, "bottom") },
      {
        id: "term",
        // Moving between columns was also a drag; the modal has the same
        // field, but this is one tap instead of four.
        label: t.term === "short" ? "→ В долгосрочные" : "→ В краткосрочные",
        onSelect: () => actions.saveTask({ ...t, term: t.term === "short" ? "long" : "short", manualOrder: null }),
      },
    ];
    if (onTaskToMeeting) items.push({ id: "meeting", label: "📅 Назначить встречу", onSelect: () => onTaskToMeeting(t.id) });
    // Sending is in here rather than only in the editor because on a phone
    // «скинуть Ане» should not cost opening a form and closing it again.
    items.push({ id: "send", label: "✈ Отправить коллеге", onSelect: () => setSendTask(t) });
    return items;
  }

  function renderColumn(list: Task[], emptyText: string, countLabel: string, term: Term, ref: RefObject<HTMLDivElement | null>) {
    const colId = term === "short" ? "colShort" : "colLong";
    const collapsed = collapsedCols[colId];
    return (
      <div className={"column" + (collapsed ? " collapsed" : "")} id={colId}>
        <div className="section-title" onClick={() => toggleCollapsed(colId)}>
          {countLabel} <span className="count">{list.length}</span>
          <span className="collapse-arrow">▾</span>
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
                progress={progressLabel(participants.forTask(t.id))}
                stage={taskStage(participants.forTask(t.id), t.approvalState || "open")}
                onToggleDone={() => toggleDone(t)}
                onOpen={() => setModalState({ open: true, task: t })}
                isDragging={draggingTaskId === t.id}
                justCreated={justCreatedId === t.id}
                menuItems={isMobile ? menuItemsFor(t) : undefined}
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
      {notifBanner && (
        <div className="notif-banner show" id="notifBanner">
          {notifBanner}
        </div>
      )}
      {extraBanner}
      {(() => {
        const filtersActive = filterSection !== "all" || filterAssignee !== "all" || filterPriority !== "all";
        const collapsed = isMobile && !filtersOpen;
        return (
          <div className={"toolbar" + (collapsed ? " collapsed" : "")}>
            <button className="btn btn-primary" id="newTaskBtn" title="Новая задача (N)" onClick={() => setModalState({ open: true, task: null })}>
              + Новая задача
            </button>
            {isMobile && (
              <button
                className={"btn toolbar-filter-toggle" + (filtersActive ? " has-filters" : "")}
                id="mobileFiltersBtn"
                onClick={() => setFiltersOpen((v) => !v)}
              >
                {filtersOpen ? "Скрыть фильтры" : "Фильтры"}
                {filtersActive && <span className="toolbar-filter-dot" />}
              </button>
            )}
            <div className="search-wrap" id="quickAddSlot" />
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
        );
      })()}

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
                  progress={progressLabel(participants.forTask(t.id))}
                  stage={taskStage(participants.forTask(t.id), t.approvalState || "open")}
                  onToggleDone={() => toggleDone(t)}
                  onOpen={() => setModalState({ open: true, task: t })}
                />
              ))
            )}
          </div>
        </div>
      )}

      {sendTask && (
        <SendMenu
          kind="task"
          id={sendTask.id}
          concerns={[sendTask.assignee]}
          anchor={null}
          onClose={() => setSendTask(null)}
          onResult={(message) => toasts.showToast(message)}
        />
      )}

      {modalOpen && (
        <TaskModal
          key={modalTask?.id ?? "new"}
          task={modalTask}
          prefill={modalPrefill}
          sections={sections}
          assignees={assignees}
          onSave={(t) => {
            actions.saveTask(t);
            // Задача только что создана — строка исполнителя заводится по
            // тому имени, которое человек уже выбрал в поле выше.
            void participants.ensureExecutorByName(t.id, t.assignee);
          }}
          onDelete={() => modalTask && deleteTask(modalTask)}
          onClose={closeModal}
          onAddAssignee={actions.addAssignee}
          onRemoveAssignee={actions.removeAssignee}
          onAddSection={actions.saveSection}
          onRemoveSection={removeSection}
          participants={modalTask ? participants.forTask(modalTask.id) : []}
          availablePeople={modalTask ? participants.availableFor(modalTask.id) : []}
          onAddParticipant={(assigneeId, role) => modalTask && void participants.add(modalTask.id, assigneeId, role)}
          onSetParticipantRole={(id, role) => void participants.setRole(id, role)}
          onRemoveParticipant={(id) => void participants.remove(id)}
          onApproveWork={async (comment) => {
            if (!modalTask) return;
            await participants.approve(modalTask.id, comment);
            // Статус — поле, которым владеет синхронизация, поэтому он
            // переключается обычным путём, а не записью в базу мимо неё.
            toggleDone({ ...modalTask, status: "in_progress" });
          }}
          onReturnWork={(comment) => modalTask && void participants.returnForRework(modalTask.id, comment)}
          onForceCloseWork={async (reason) => {
            if (!modalTask) return;
            await participants.forceClose(modalTask.id, reason);
            toggleDone({ ...modalTask, status: "in_progress" });
          }}
        />
      )}
    </div>
  );
}
