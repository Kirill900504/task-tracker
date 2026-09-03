"use client";

// New UI, built up phase by phase per the approved migration plan.
// Phase 3: task columns, card, modal (incl. recurrence), done/undo — the
// first real slice of the rewrite. Meetings/calendar/ideas/drag-and-drop/
// notifications/panel layout still come from later phases and aren't
// rendered here yet.

import { useTrackerData } from "@/hooks/useTrackerData";
import { useToasts } from "@/hooks/useToasts";
import TasksPanel from "@/components/tracker/TasksPanel";
import ToastStack from "@/components/tracker/ToastStack";

export default function NewTracker() {
  const { loading, loadError, tasks, sections, assignees, syncStatus, actions } = useTrackerData();
  const toasts = useToasts();

  if (loadError) {
    return <div style={{ padding: 24 }}>Не удалось загрузить данные из облака: {loadError}</div>;
  }
  if (loading) {
    return <div style={{ padding: 24 }}>Загрузка…</div>;
  }

  return (
    <>
      <ToastStack toasts={toasts.toasts} onUndo={toasts.undo} onDismiss={toasts.dismiss} />
      <div id="syncStatus" className="show">
        {syncStatus.pending ? "Сохраняю…" : syncStatus.lastError ? `⚠ ${syncStatus.lastError}` : "✓ Сохранено"}
      </div>
      <header>
        <div className="header-row">
          <div className="brand">
            <div>
              <h1>Планировщик задач</h1>
            </div>
          </div>
          <div className="header-btns">
            <button className="btn" id="signOutBtn" onClick={() => actions.signOut()}>
              Выйти
            </button>
          </div>
        </div>
      </header>
      <div className="layout">
        <div className="dash-zone">
          <TasksPanel tasks={tasks} sections={sections} assignees={assignees} actions={actions} toasts={toasts} />
        </div>
      </div>
    </>
  );
}
