"use client";

// New UI, built up phase by phase per the approved migration plan.
// Phase 4 adds meetings + calendar alongside Phase 3's tasks. Ideas,
// drag-and-drop, notifications, and panel-layout persistence still come
// from later phases.

import { useState } from "react";
import { useTrackerData } from "@/hooks/useTrackerData";
import { useToasts } from "@/hooks/useToasts";
import { useDateTimeConfirm } from "@/hooks/useDateTimeConfirm";
import TasksPanel from "@/components/tracker/TasksPanel";
import MeetingsPanel from "@/components/tracker/MeetingsPanel";
import CalendarPanel from "@/components/tracker/CalendarPanel";
import ToastStack from "@/components/tracker/ToastStack";

export default function NewTracker() {
  const { loading, loadError, tasks, meetings, sections, assignees, syncStatus, actions } = useTrackerData();
  const toasts = useToasts();
  const dateTimeConfirm = useDateTimeConfirm();

  // "Показывать завершённые" is one shared toggle for done tasks AND
  // resolved meetings — see TasksPanel's prop comment.
  const [showDone, setShowDone] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [openTaskRequest, setOpenTaskRequest] = useState<string | null>(null);
  const [openMeetingRequest, setOpenMeetingRequest] = useState<string | null>(null);

  if (loadError) {
    return <div style={{ padding: 24 }}>Не удалось загрузить данные из облака: {loadError}</div>;
  }
  if (loading) {
    return <div style={{ padding: 24 }}>Загрузка…</div>;
  }

  return (
    <>
      <ToastStack toasts={toasts.toasts} onUndo={toasts.undo} onDismiss={toasts.dismiss} />
      {dateTimeConfirm.dialog}
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
          <CalendarPanel
            tasks={tasks}
            meetings={meetings}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onRequestNewTask={(date) => setOpenTaskRequest(date)}
            onRequestNewMeeting={(date) => setOpenMeetingRequest(date)}
          />
          <MeetingsPanel
            meetings={meetings}
            assignees={assignees}
            showResolved={showDone}
            selectedDay={selectedDate}
            actions={actions}
            toasts={toasts}
            dateTimeConfirm={dateTimeConfirm}
            openMeetingRequest={openMeetingRequest}
            onOpenMeetingHandled={() => setOpenMeetingRequest(null)}
          />
        </div>
        <div className="dash-zone">
          <TasksPanel
            tasks={tasks}
            sections={sections}
            assignees={assignees}
            actions={actions}
            toasts={toasts}
            showDone={showDone}
            onShowDoneChange={setShowDone}
            calendarFilterDate={selectedDate}
            openTaskRequest={openTaskRequest}
            onOpenTaskHandled={() => setOpenTaskRequest(null)}
          />
        </div>
      </div>
    </>
  );
}
