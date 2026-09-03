"use client";

// Port of the task columns + toolbar from public/legacy-tracker.js
// (render(), matchesFilters(), sortFn/rankOf, the modal open/save/delete
// flow). Drag-and-drop reordering is deliberately not included yet — that's
// a later phase (see the approved migration plan) — so cards aren't
// draggable here, everything else (filters, sort groups, recurrence, done/
// undo) is a faithful behavioral port.
import { useMemo, useState } from "react";
import type { Section, Task } from "@/types/tracker";
import { taskSortFn } from "@/lib/taskDisplay";
import TaskCard from "./TaskCard";
import TaskModal from "./TaskModal";
import type { useToasts } from "@/hooks/useToasts";

export default function TasksPanel({
  tasks,
  sections,
  assignees,
  actions,
  toasts,
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
}) {
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterSection, setFilterSection] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const [modalState, setModalState] = useState<{ open: boolean; task: Task | null; presetDeadline?: string }>({ open: false, task: null });

  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  const filtered = tasks.filter((t) => {
    if (filterAssignee !== "all" && t.assignee !== filterAssignee) return false;
    if (filterPriority !== "all" && t.priority !== filterPriority) return false;
    if (filterSection !== "all" && (t.sectionId || "") !== filterSection) return false;
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

  function renderColumn(list: Task[], emptyText: string, countLabel: string) {
    return (
      <div className="column">
        <div className="section-title">
          {countLabel} <span className="count">{list.length}</span>
        </div>
        <div>
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
              />
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="main-col" id="mainCol">
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
          <input type="checkbox" id="showDoneCheckbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Показывать завершённые
        </label>
      </div>

      <div className="columns">
        {renderColumn(shortOpen, "Нет краткосрочных задач по текущим фильтрам", "Краткосрочные")}
        {renderColumn(longOpen, "Нет долгосрочных задач по текущим фильтрам", "Долгосрочные")}
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

      {modalState.open && (
        <TaskModal
          key={modalState.task?.id ?? "new"}
          task={modalState.task}
          presetDeadline={modalState.presetDeadline}
          sections={sections}
          assignees={assignees}
          onSave={actions.saveTask}
          onDelete={() => modalState.task && deleteTask(modalState.task)}
          onClose={() => setModalState({ open: false, task: null })}
          onAddAssignee={actions.addAssignee}
          onRemoveAssignee={actions.removeAssignee}
          onAddSection={actions.saveSection}
          onRemoveSection={removeSection}
        />
      )}
    </div>
  );
}
