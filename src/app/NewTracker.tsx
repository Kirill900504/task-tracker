"use client";

// New UI, built up phase by phase per the approved migration plan.
// Phase 6 adds drag-and-drop: task reorder/column-move, idea→task/meeting
// conversion, and (still to come in this same pass) meeting→calendar and
// dashboard panel rearrange.

import { useEffect, useState } from "react";
import { useTrackerData } from "@/hooks/useTrackerData";
import { useToasts } from "@/hooks/useToasts";
import { useDateTimeConfirm } from "@/hooks/useDateTimeConfirm";
import { useNotifications } from "@/hooks/useNotifications";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import TasksPanel from "@/components/tracker/TasksPanel";
import MeetingsPanel from "@/components/tracker/MeetingsPanel";
import CalendarPanel from "@/components/tracker/CalendarPanel";
import IdeasPanel from "@/components/tracker/IdeasPanel";
import ToastStack from "@/components/tracker/ToastStack";
import DashboardLayout from "@/components/tracker/DashboardLayout";
import { pad, todayStr } from "@/lib/taskDisplay";
import { uid } from "@/lib/uid";
import { DEFAULT_PANEL_LAYOUT, formatIdeaCreatedAt } from "@/lib/trackerRows";
import type { Meeting, MeetingPrefill, Task, TaskPrefill } from "@/types/tracker";
import QuickAdd, { type QuickAddProvider } from "@/app/QuickAdd";

const WEEKDAY_NAMES_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
function formatClock(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${WEEKDAY_NAMES_FULL[d.getDay()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NewTracker() {
  const { loading, loadError, tasks, meetings, ideas, sections, assignees, panelLayout, syncStatus, actions } = useTrackerData();
  const toasts = useToasts();
  const dateTimeConfirm = useDateTimeConfirm();
  const notifications = useNotifications({ tasks, meetings, saveTask: actions.saveTask, showToast: toasts.showToast, ready: !loading });
  const installPrompt = useInstallPrompt();

  const [clockText, setClockText] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setClockText(formatClock(new Date())), 30000);
    return () => clearInterval(timer);
  }, []);

  // "Показывать завершённые" is one shared toggle for done tasks AND
  // resolved meetings — see TasksPanel's prop comment.
  const [showDone, setShowDone] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [openTaskRequest, setOpenTaskRequest] = useState<TaskPrefill | null>(null);
  const [openMeetingRequest, setOpenMeetingRequest] = useState<MeetingPrefill | null>(null);
  const [justCreatedTaskId, setJustCreatedTaskId] = useState<string | null>(null);
  const [justCreatedMeetingId, setJustCreatedMeetingId] = useState<string | null>(null);

  function flashTask(id: string) {
    setJustCreatedTaskId(id);
    setTimeout(() => setJustCreatedTaskId((cur) => (cur === id ? null : cur)), 1200);
  }
  function flashMeeting(id: string) {
    setJustCreatedMeetingId(id);
    setTimeout(() => setJustCreatedMeetingId((cur) => (cur === id ? null : cur)), 1200);
  }

  // Port of convertIdeaToTask()/convertIdeaToMeeting() — the idea's removal
  // and the new item's creation share ONE undo toast, matching legacy
  // exactly (undoing puts the idea back and removes the created item).
  function convertIdeaToTask(ideaId: string, term: "short" | "long") {
    const idea = ideas.find((i) => i.id === ideaId);
    if (!idea) return;
    actions.deleteIdea(idea.id);
    const task: Task = {
      id: uid(),
      title: idea.text,
      desc: "",
      assignee: "",
      sectionId: "",
      priority: idea.important ? "high" : "med",
      term,
      status: "in_progress",
      deadline: "",
      recur: "none",
      recurWeekday: "1",
      recurMonthday: "",
      recurYearDay: "",
      recurYearMonth: "1",
      lastCompletedOn: "",
      manualOrder: null,
    };
    actions.saveTask(task);
    flashTask(task.id);
    toasts.showToast("Идея превращена в задачу", task.title, () => {
      actions.deleteTask(task.id);
      actions.restoreIdea(idea);
    });
  }

  async function convertIdeaToMeeting(ideaId: string) {
    const idea = ideas.find((i) => i.id === ideaId);
    if (!idea) return;
    const result = await dateTimeConfirm.ask(`Встреча «${idea.text}» на:`, todayStr(), "10:00");
    if (!result) return;
    actions.deleteIdea(idea.id);
    const meeting: Meeting = {
      id: uid(),
      date: result.date,
      time: result.time || "",
      title: idea.text,
      participants: [],
      status: "planned",
      result: "",
      movedToDate: "",
    };
    actions.saveMeeting(meeting);
    flashMeeting(meeting.id);
    toasts.showToast("Идея превращена во встречу", meeting.title, () => {
      actions.deleteMeeting(meeting.id);
      actions.restoreIdea(idea);
    });
  }

  const quickAddProvider: QuickAddProvider = {
    getAssignees: () => assignees,
    prefillNewTask: (f) => setOpenTaskRequest({ title: f.title, desc: f.description, assignee: f.assignee, priority: f.priority, term: f.term, deadline: f.deadline }),
    prefillNewMeeting: (f) => setOpenMeetingRequest({ title: f.title, date: f.date, time: f.time, participants: f.participants }),
    createTask: (f) => {
      actions.saveTask({
        id: uid(),
        title: f.title,
        desc: f.description,
        assignee: f.assignee,
        sectionId: "",
        priority: f.priority,
        term: f.term,
        status: "in_progress",
        deadline: f.deadline,
        recur: "none",
        recurWeekday: "1",
        recurMonthday: "",
        recurYearDay: "",
        recurYearMonth: "1",
        lastCompletedOn: "",
        manualOrder: null,
      });
    },
    createMeeting: (f) => {
      actions.saveMeeting({
        id: uid(),
        date: f.date,
        time: f.time || "",
        title: f.title,
        participants: f.participants,
        status: "planned",
        result: "",
        movedToDate: "",
      });
    },
    createIdea: (f) => {
      actions.saveIdea({
        id: uid(),
        text: f.text,
        important: f.important,
        done: false,
        createdAt: formatIdeaCreatedAt(new Date()),
      });
    },
  };

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
      <QuickAdd provider={quickAddProvider} />
      <div id="syncStatus" className="show">
        {syncStatus.pending ? "Сохраняю…" : syncStatus.lastError ? `⚠ ${syncStatus.lastError}` : "✓ Сохранено"}
      </div>
      <header>
        <div className="header-row">
          <div className="brand">
            <div>
              <h1>Планировщик задач</h1>
              <div className="subtitle" id="dateNow">
                {clockText}
              </div>
            </div>
          </div>
          <div className="header-btns">
            {notifications.permission !== "unsupported" && (
              <button className="btn" id="notifPermBtn" onClick={notifications.requestPermission}>
                {notifications.permission === "granted" ? "🔔 Уведомления включены" : "🔔 Включить уведомления"}
              </button>
            )}
            {installPrompt.visible && (
              <button className="btn btn-primary" id="installAppBtn" onClick={installPrompt.promptInstall}>
                📥 Установить
              </button>
            )}
            {JSON.stringify(panelLayout) !== JSON.stringify(DEFAULT_PANEL_LAYOUT) && (
              <button
                className="btn"
                id="resetLayoutBtn"
                title="Панели вернутся на исходные места"
                onClick={() => actions.savePanelLayout(DEFAULT_PANEL_LAYOUT)}
              >
                ↺ Сбросить расположение
              </button>
            )}
            <button className="btn" id="signOutBtn" onClick={() => actions.signOut()}>
              Выйти
            </button>
          </div>
        </div>
      </header>
      <DashboardLayout
        layout={panelLayout}
        onLayoutChange={actions.savePanelLayout}
        panels={{
          calPanel: (
            <CalendarPanel
              tasks={tasks}
              meetings={meetings}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onRequestNewTask={(date) => setOpenTaskRequest({ deadline: date })}
              onRequestNewMeeting={(date) => setOpenMeetingRequest({ date })}
              dateTimeConfirm={dateTimeConfirm}
              onRescheduleMeeting={(meeting, date, time) => {
                actions.saveMeeting({ ...meeting, date, time: time || meeting.time });
                toasts.showToast("Встреча перенесена", meeting.title, () => actions.saveMeeting(meeting));
              }}
            />
          ),
          meetingsPanel: (
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
              onIdeaDropped={convertIdeaToMeeting}
              justCreatedId={justCreatedMeetingId}
            />
          ),
          mainCol: (
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
              onIdeaDropped={convertIdeaToTask}
              justCreatedId={justCreatedTaskId}
              notifBanner={notifications.bannerText}
            />
          ),
          ideasPanel: <IdeasPanel ideas={ideas} showDone={showDone} actions={actions} toasts={toasts} />,
        }}
      />
    </>
  );
}
