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
import { useTelegramLink } from "@/hooks/useTelegramLink";
import SyncErrorBanner from "@/components/tracker/SyncErrorBanner";
import SyncStatusPill from "@/components/tracker/SyncStatusPill";
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
  const telegram = useTelegramLink();

  const [clockText, setClockText] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setClockText(formatClock(new Date())), 30000);
    return () => clearInterval(timer);
  }, []);

  // Header toggles for the calendar/ideas panels — same as legacy's
  // calOpen/ideasOpen: hiding a panel also collapses the layout column it
  // was sitting in (see DashboardLayout's hiddenPanels prop).
  const [calOpen, setCalOpen] = useState(true);
  const [ideasOpen, setIdeasOpen] = useState(true);


  // "Показывать завершённые" is one shared toggle for done tasks AND
  // resolved meetings — see TasksPanel's prop comment.
  const [showDone, setShowDone] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [openTaskRequest, setOpenTaskRequest] = useState<TaskPrefill | null>(null);
  const [openMeetingRequest, setOpenMeetingRequest] = useState<MeetingPrefill | null>(null);
  const [justCreatedTaskId, setJustCreatedTaskId] = useState<string | null>(null);
  const [justCreatedMeetingId, setJustCreatedMeetingId] = useState<string | null>(null);

  // Hotkey N — new task. Keyed off the physical key (e.code) so it works on a
  // Russian layout too, and ignored while typing or with a modal already up.
  // The open-modal check reads the DOM rather than lifting every panel's modal
  // state up here: each modal renders `.overlay.open`, same as legacy did.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "KeyN" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = (el?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;
      if (document.querySelector(".overlay.open")) return;
      e.preventDefault();
      setOpenTaskRequest({});
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

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
      completedAt: "",
    };
    actions.saveTask(task);
    flashTask(task.id);
    toasts.showToast("Идея превращена в задачу", task.title, () => {
      actions.deleteTask(task.id);
      actions.restoreIdea(idea);
    });
  }

  // Dragging an idea or a task onto a calendar day opens the meeting modal
  // pre-filled with its title and that date — participants and time are then
  // picked in the normal form. The source idea is only consumed once the
  // meeting is actually saved (cancelling the modal leaves it untouched); a
  // dragged task stays where it is, since a meeting about a task doesn't
  // replace the task itself.
  const [pendingIdeaConversion, setPendingIdeaConversion] = useState<string | null>(null);

  function ideaDroppedOnDate(ideaId: string, date: string) {
    const idea = ideas.find((i) => i.id === ideaId);
    if (!idea) return;
    setPendingIdeaConversion(idea.id);
    setOpenMeetingRequest({ title: idea.text, date, time: "10:00" });
  }

  function taskDroppedOnDate(taskId: string, date: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setPendingIdeaConversion(null);
    setOpenMeetingRequest({ title: task.title, date, time: "10:00", participants: task.assignee ? [task.assignee] : [] });
  }

  function requestedMeetingSaved(meeting: Meeting) {
    flashMeeting(meeting.id);
    if (!pendingIdeaConversion) return;
    const idea = ideas.find((i) => i.id === pendingIdeaConversion);
    setPendingIdeaConversion(null);
    if (!idea) return;
    actions.deleteIdea(idea.id);
    toasts.showToast("Идея превращена во встречу", meeting.title, () => {
      actions.deleteMeeting(meeting.id);
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
      resolvedAt: "",
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
        completedAt: "",
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
        resolvedAt: "",
      });
    },
    createIdea: (f) => {
      actions.saveIdea({
        id: uid(),
        text: f.text,
        important: f.important,
        done: false,
        createdAt: formatIdeaCreatedAt(new Date()),
        doneAt: "",
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
      {syncStatus.everSaved && (
        <SyncStatusPill
          key={syncStatus.pending ? "pending" : syncStatus.lastError ? "error:" + syncStatus.lastError : "saved"}
          text={syncStatus.pending ? "Сохраняю…" : syncStatus.lastError ? `⚠ ${syncStatus.lastError}` : "✓ Сохранено"}
          autoHide={!syncStatus.pending && !syncStatus.lastError}
        />
      )}
      <header>
        <div className="header-row">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- same plain <img> the legacy markup used; next/image adds nothing for a fixed-size local logo */}
            <img className="brand-logo" src="/favicon.png" alt="РОКАС" />
            <div>
              <h1>РОКАС</h1>
              <div className="subtitle" id="dateNow">
                {clockText}
              </div>
            </div>
          </div>
          <div className="header-quote">
            <div className="hqline">
              Есть десятилетия, за которые ничего не случается, <b>и есть недели, за которые случаются десятилетия.</b>
            </div>
          </div>
          <div className="header-btns">
            <button className={"btn" + (ideasOpen ? " active" : "")} id="ideasToggleBtn" onClick={() => setIdeasOpen((v) => !v)}>
              💡 Идеи
            </button>
            <button className={"btn" + (calOpen ? " active" : "")} id="calToggleBtn" onClick={() => setCalOpen((v) => !v)}>
              📅 Календарь
            </button>
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
            {telegram.visible && (
              <button className="btn" id="telegramLinkBtn" onClick={telegram.link}>
                🔗 Telegram
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
        hiddenPanels={[...(calOpen ? [] : ["calPanel"]), ...(ideasOpen ? [] : ["ideasPanel"])]}
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
              onIdeaDroppedOnDate={ideaDroppedOnDate}
              onTaskDroppedOnDate={taskDroppedOnDate}
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
              onOpenMeetingHandled={() => {
                setOpenMeetingRequest(null);
                setPendingIdeaConversion(null);
              }}
              onRequestedMeetingSaved={requestedMeetingSaved}
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
              extraBanner={<SyncErrorBanner />}
            />
          ),
          ideasPanel: <IdeasPanel ideas={ideas} showDone={showDone} actions={actions} toasts={toasts} />,
        }}
      />
    </>
  );
}
