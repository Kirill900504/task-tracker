"use client";

// New UI, built up phase by phase per the approved migration plan.
// Phase 6 adds drag-and-drop: task reorder/column-move, idea→task/meeting
// conversion, and (still to come in this same pass) meeting→calendar and
// dashboard panel rearrange.

import { useEffect, useMemo, useState } from "react";
import { useTrackerData } from "@/hooks/useTrackerData";
import { useToasts } from "@/hooks/useToasts";
import { useDateTimeConfirm } from "@/hooks/useDateTimeConfirm";
import { useNotifications } from "@/hooks/useNotifications";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useBotLink } from "@/hooks/useBotLink";
import { prefetchTeam } from "@/hooks/useColleagues";
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
import { assignExecutorsByName } from "@/lib/assignWork";
import { DEFAULT_PANEL_LAYOUT, formatIdeaCreatedAt, sameLayout } from "@/lib/trackerRows";
import type { Meeting, MeetingPrefill, Task, TaskPrefill } from "@/types/tracker";
import QuickAdd, { type QuickAddProvider } from "@/app/QuickAdd";
import { mergeResult } from "@/lib/meetingLink";
import SearchOverlay from "@/components/tracker/SearchOverlay";
import ExportMenu from "@/components/tracker/ExportMenu";
import TeamModal from "@/components/tracker/TeamModal";
import MobileShell, { type MobileTab } from "@/components/tracker/MobileShell";
import MobileHeader from "@/components/tracker/MobileHeader";
import HeaderQuote from "@/components/tracker/HeaderQuote";
import TodayScreen from "@/components/tracker/TodayScreen";
import ReviewScreen, { awaitingReview } from "@/components/tracker/ReviewScreen";
import PeoplePanel from "@/components/tracker/PeoplePanel";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { bumpVoteRoundIfMoved } from "@/lib/meetingRound";
import ManagerScreen from "@/components/tracker/ManagerScreen";
import { buildToday, todayCount } from "@/lib/todayScreen";
import type { SearchResult } from "@/lib/localSearch";
import Icon from "@/components/tracker/Icon";

const WEEKDAY_NAMES_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
function formatClock(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${WEEKDAY_NAMES_FULL[d.getDay()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NewTracker() {
  // Владелец или руководитель.
  //
  // Раньше здесь стояла развилка на два разных приложения: владельцу трекер,
  // руководителю экран из четырёх кнопок. Кирилл попросил другого — «чтобы у
  // моих коллег был такой же интерфейс работы с таск-трекером, как и у меня
  // со всеми возможностями, НО ФУНКЦИЯ АДМИНИСТРАТОРА БЫЛА ТОЛЬКО У МЕНЯ».
  // Поэтому трекер теперь один на всех, а разница — в том, что за админским
  // флагом спрятано, и, главное, в том, что запрещено политиками базы
  // (миграция 0031). Прятать кнопку мало: запрет, который обходится через
  // консоль браузера, не запрет.
  const identity = useWorkspaceRole();

  // Пока роль не выяснена — не грузим ничего: пространство, которое надо
  // загрузить, ещё неизвестно, а тянуть «на всякий случай» значит писать
  // чужие данные от чужого имени.
  const ready = !identity.loading;
  const isAdmin = identity.isAdmin;
  // Пересоздаётся только при смене роли: объект уходит в ссылку внутри
  // слоя данных, и новая ссылка на каждый рендер гоняла бы эффект впустую.
  const workspace = useMemo(
    () => ({ ownerId: identity.ownerId, userId: identity.userId, isManager: identity.role === "manager" }),
    [identity.ownerId, identity.userId, identity.role],
  );
  const { loading, loadError, tasks, meetings, ideas, sections, assignees, panelLayout, syncStatus, offline, actions } =
    useTrackerData({ enabled: ready, workspace });
  const isMobile = useIsMobile();
  const toasts = useToasts();
  const dateTimeConfirm = useDateTimeConfirm();
  const notifications = useNotifications({ tasks, meetings, saveTask: actions.saveTask, showToast: toasts.showToast, ready: !loading });
  const installPrompt = useInstallPrompt();
  const botLink = useBotLink();

  const [clockText, setClockText] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setClockText(formatClock(new Date())), 30000);
    return () => clearInterval(timer);
  }, []);

  // The calendar and the ideas panel used to have header toggles (legacy's
  // calOpen/ideasOpen). They are always on now: he never hid them, and the
  // two buttons were only taking room away from the header.

  // "Показывать завершённые" is one shared toggle for done tasks AND
  // resolved meetings — see TasksPanel's prop comment.
  const [showDone, setShowDone] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [openTaskRequest, setOpenTaskRequest] = useState<TaskPrefill | null>(null);
  const [openMeetingRequest, setOpenMeetingRequest] = useState<MeetingPrefill | null>(null);
  const [justCreatedTaskId, setJustCreatedTaskId] = useState<string | null>(null);
  const [justCreatedMeetingId, setJustCreatedMeetingId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("today");
  const [openExistingTaskId, setOpenExistingTaskId] = useState<string | null>(null);
  const [openExistingMeetingId, setOpenExistingMeetingId] = useState<string | null>(null);
  const [highlightIdeaId, setHighlightIdeaId] = useState<string | null>(null);
  // Один фильтр на панель задач и панель «Люди»: нажатие на человека и
  // выбор в списке — это один и тот же вопрос, заданный двумя способами.
  const [filterAssignee, setFilterAssignee] = useState("all");

  // Список команды спрашивается заранее, а не в момент нажатия. «Команда» и
  // любое ✈ открываются из уже открытого трекера, то есть время на запрос
  // есть — и тратить его надо здесь, а не после нажатия, когда человек
  // смотрит на «Загрузка…».
  useEffect(() => {
    prefetchTeam();
  }, []);

  // Hotkeys: N — task, B — meeting, M — idea, "/" — search. Keyed off the
  // physical key (e.code) so they work on a Russian layout too, and ignored
  // while typing or with a modal already up. The open-modal check reads the
  // DOM rather than lifting every panel's modal state up here: each modal
  // renders `.overlay.open`, same as legacy did.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = (el?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;
      if (document.querySelector(".overlay.open")) return;

      if (e.code === "KeyN") {
        e.preventDefault();
        setOpenTaskRequest({});
        return;
      }
      if (e.code === "KeyB") {
        e.preventDefault();
        // Same default as the panel's own «+»: the day picked in the calendar,
        // otherwise today — never an empty date the form would reject.
        setOpenMeetingRequest({ date: selectedDate ?? todayStr() });
        return;
      }
      if (e.code === "KeyM") {
        // The ideas panel is always on screen now; the timeout stays because
        // focus has to wait for the panel that may still be mounting.
        e.preventDefault();
        setTimeout(() => document.getElementById("ideaInput")?.focus(), 60);
        return;
      }
      // Both the key next to the right shift and the one Russian layouts put
      // "/" on reach this the same way — match the character, not the code.
      if (e.key === "/" || e.key === ".") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedDate]);

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
    setOpenMeetingRequest({
      title: task.title,
      date,
      time: "10:00",
      participants: task.assignee ? [task.assignee] : [],
      fromTaskId: task.id,
      fromTaskTitle: task.title,
    });
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

  function openSearchResult(result: SearchResult) {
    setSearchOpen(false);
    if (result.kind === "task") {
      setOpenExistingTaskId(result.id);
      return;
    }
    if (result.kind === "meeting") {
      setOpenExistingMeetingId(result.id);
      return;
    }
    // An idea has no card of its own — show it where it lives, unfolding the
    // completed list first for one that is already ticked off.
    if (result.done) setShowDone(true);
    setHighlightIdeaId(result.id);
    setTimeout(() => {
      document.querySelector(`[data-idea-id="${result.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    setTimeout(() => setHighlightIdeaId((cur) => (cur === result.id ? null : cur)), 1600);
  }

  const quickAddProvider: QuickAddProvider = {
    getAssignees: () => assignees,
    prefillNewTask: (f) =>
      setOpenTaskRequest({
        title: f.title,
        desc: f.description,
        assignee: f.assignee,
        executors: f.executors || [],
        priority: f.priority,
        term: f.term,
        deadline: f.deadline,
      }),
    prefillNewMeeting: (f) => setOpenMeetingRequest({ title: f.title, date: f.date, time: f.time, participants: f.participants }),
    createTask: (f) => {
      const id = uid();
      actions.saveTask({
        id,
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
      // Задача, заведённая строкой быстрого ввода, минует карточку — но
      // не правило: исполнители получают строку участия и сообщение так
      // же, как если бы их вписали руками.
      void assignExecutorsByName(id, [f.assignee, ...(f.executors || [])]);
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
    // Dictated meeting notes matched an open meeting: write the recap into
    // its card and mark it held, the same state the panel's own «Успешно»
    // button produces, so the meeting stops sitting there as planned.
    closeMeetingWithResult: ({ id, summary }) => {
      const meeting = meetings.find((m) => m.id === id);
      if (!meeting) return;
      actions.saveMeeting({
        ...meeting,
        status: "success",
        result: mergeResult(meeting.result, summary),
        resolvedAt: new Date().toISOString(),
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

  // Built once and handed to whichever layout is on screen: the desktop's
  // three-column constructor, or the phone's one-section-at-a-time shell.
  const panels = {
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
              const moved = { ...meeting, date, time: time || meeting.time };
              actions.saveMeeting(moved);
              // Перетащили в календаре — это тот же перенос, что и правка
              // даты в карточке, и голосование обнуляется так же.
              void bumpVoteRoundIfMoved(meeting.id, meeting, moved);
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
            openExistingMeetingId={openExistingMeetingId}
            onOpenExistingHandled={() => setOpenExistingMeetingId(null)}
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
            isAdmin={isAdmin}
            filterAssignee={filterAssignee}
            onFilterAssigneeChange={setFilterAssignee}
            tasks={tasks}
            sections={sections}
            assignees={assignees}
            actions={actions}
            toasts={toasts}
            showDone={showDone}
            onShowDoneChange={setShowDone}
            calendarFilterDate={selectedDate}
            openTaskRequest={openTaskRequest}
            openExistingTaskId={openExistingTaskId}
            onOpenExistingHandled={() => setOpenExistingTaskId(null)}
            onOpenTaskHandled={() => setOpenTaskRequest(null)}
            onIdeaDropped={convertIdeaToTask}
            onTaskToMeeting={(id) => taskDroppedOnDate(id, selectedDate ?? todayStr())}
            onScheduleMeetingFor={(task, people) =>
              setOpenMeetingRequest({
                title: task.title,
                date: selectedDate ?? todayStr(),
                time: "10:00",
                participants: people,
                fromTaskId: task.id,
                fromTaskTitle: task.title,
              })
            }
            justCreatedId={justCreatedTaskId}
            notifBanner={notifications.bannerText}
            extraBanner={
              <>
                {offline && (
                  <div className="notif-banner show" id="offlineBanner">
                    <span>📴 Нет связи с облаком — показываю сохранённую копию. Всё, что записываете, отправится, как только связь вернётся.</span>
                  </div>
                )}
                <SyncErrorBanner />
              </>
            }
          />
        ),
        // «Сегодня» был только на телефоне. Утром на компьютере первый
        // взгляд упирался в три столбца, и сегодняшнее приходилось искать
        // глазами — при том что экран, отвечающий на этот вопрос, уже
        // написан. Панель, а не отдельная страница: её можно переставить
        // или убрать, как любую другую.
        todayPanel: (
          <div className="panel dash-panel" data-panel-id="todayPanel">
            <TodayScreen
              tasks={tasks}
              meetings={meetings}
              sections={sections}
              onToggleTask={(task) =>
                actions.saveTask({
                  ...task,
                  status: task.status === "done" ? "in_progress" : "done",
                  completedAt: task.status === "done" ? "" : new Date().toISOString(),
                })
              }
              onOpenTask={(task) => setOpenExistingTaskId(task.id)}
              onOpenMeeting={(meeting) => setOpenExistingMeetingId(meeting.id)}
              showToast={toasts.showToast}
            />
          </div>
        ),
        peoplePanel: (
          <PeoplePanel tasks={tasks} assignees={assignees} selected={filterAssignee} onSelect={setFilterAssignee} />
        ),
        ideasPanel: (
          <IdeasPanel
            ideas={ideas}
            showDone={showDone}
            highlightId={highlightIdeaId}
            actions={actions}
            toasts={toasts}
            onConvertToTask={convertIdeaToTask}
            onConvertToMeeting={convertIdeaToMeeting}
          />
        ),
  };
  // Руководитель попадает на свой экран, а не в трекер владельца с
  // выключенными кнопками. Проверка стоит до loadError/loading владельца:
  // его загрузка руководителя не касается, и её ошибка не должна
  // показывать ему «не получилось загрузить данные».
  // Раздел «Что от вас ждут» — только у руководителя, и внутри трекера, а
  // не вместо него. У владельца его нет: задачи ставит он, и отдельный
  // список «что мне поручили» у него всегда был бы пуст.
  const assignedToMe =
    identity.role === "manager" && identity.assigneeId ? (
      <ManagerScreen embedded assigneeId={identity.assigneeId} name={identity.name} />
    ) : null;

  if (loadError) {
    // Not a dead end: the tracker keeps trying in the background and opens
    // itself the moment the connection answers. The buttons are for the
    // cases where waiting will not help — a stuck session most of all.
    return (
      <div className="boot-error">
        <div className="boot-error-mark">📡</div>
        <div className="boot-error-title">Не получилось загрузить данные</div>
        <div className="boot-error-sub">{loadError}. Пробую снова каждые 15 секунд — как только связь появится, трекер откроется сам.</div>
        <div className="boot-error-actions">
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Повторить сейчас
          </button>
          <button className="btn" onClick={() => actions.signOut()}>
            Выйти
          </button>
        </div>
      </div>
    );
  }
  if (identity.loading || loading) {
    return <div style={{ padding: 24 }}>Загрузка…</div>;
  }

  return (
    <>
      <ToastStack toasts={toasts.toasts} onUndo={toasts.undo} onDismiss={toasts.dismiss} />
      {dateTimeConfirm.dialog}
      <QuickAdd provider={quickAddProvider} />
      {teamOpen && isAdmin && <TeamModal onClose={() => setTeamOpen(false)} />}
      {searchOpen && (
        <SearchOverlay
          tasks={tasks}
          meetings={meetings}
          ideas={ideas}
          onClose={() => setSearchOpen(false)}
          onOpenResult={openSearchResult}
        />
      )}
      {syncStatus.everSaved && (
        <SyncStatusPill
          key={syncStatus.pending ? "pending" : syncStatus.lastError ? "error:" + syncStatus.lastError : "saved"}
          text={syncStatus.pending ? "Сохраняю…" : syncStatus.lastError ? `⚠ ${syncStatus.lastError}` : "✓ Сохранено"}
          autoHide={!syncStatus.pending && !syncStatus.lastError}
        />
      )}
      {isMobile ? (
        <>
          <MobileHeader
            clockText={clockText}
            onSearch={() => setSearchOpen(true)}
            items={[
              ...(isAdmin ? [{ id: "team", label: "👥 Команда", onSelect: () => setTeamOpen(true) }] : []),
              { id: "done", label: showDone ? "🙈 Скрыть завершённые" : "👁 Показать завершённые", onSelect: () => setShowDone((v) => !v) },
              ...(notifications.permission !== "unsupported"
                ? [
                    {
                      id: "notif",
                      label: notifications.permission === "granted" ? "🔔 Уведомления включены" : "🔔 Включить уведомления",
                      onSelect: notifications.requestPermission,
                      disabled: notifications.permission === "granted",
                    },
                  ]
                : []),
              ...(installPrompt.visible ? [{ id: "install", label: "📥 Установить приложение", onSelect: installPrompt.promptInstall }] : []),
              ...(botLink.needs.telegram ? [{ id: "tg", label: "🔗 Подключить Telegram", onSelect: () => botLink.link("telegram") }] : []),
              ...(botLink.needs.max ? [{ id: "max", label: "🔗 Подключить MAX", onSelect: () => botLink.link("max") }] : []),
              { id: "signout", label: "Выйти", onSelect: () => actions.signOut() },
            ]}
          />
          <MobileShell
            tab={mobileTab}
            onTabChange={setMobileTab}
            badges={{
              today: todayCount(buildToday(tasks, meetings)),
              meetings: meetings.filter((m) => !m.status || m.status === "planned").length,
              ideas: ideas.filter((i) => !i.done).length,
              review: awaitingReview(tasks).length,
            }}
          >
            {/* Every section stays mounted and is merely hidden: switching tabs
                keeps scroll position and open editors, and the modals inside
                them are portalled to <body>, so they show over the shell. */}
            <div hidden={mobileTab !== "today"}>
              {/* У руководителя «Сегодня» начинается с того, чего ждут от
                  него: на телефоне он чаще всего открывает трекер именно
                  затем, чтобы ответить. */}
              {assignedToMe}
              <TodayScreen
                tasks={tasks}
                meetings={meetings}
                sections={sections}
                onToggleTask={(task) => actions.saveTask({ ...task, status: task.status === "done" ? "in_progress" : "done", completedAt: task.status === "done" ? "" : new Date().toISOString() })}
                onOpenTask={(task) => setOpenExistingTaskId(task.id)}
                onOpenMeeting={(meeting) => setOpenExistingMeetingId(meeting.id)}
                onGoToTasks={() => setMobileTab("tasks")}
                showToast={toasts.showToast}
              />
            </div>
            <div hidden={mobileTab !== "tasks"}>{panels.mainCol}</div>
            {/* Календарь месяца переехал сюда из пятой вкладки: его
                открывают вместе со встречами, а не вместо них. */}
            <div hidden={mobileTab !== "meetings"}>
              {panels.calPanel}
              {panels.meetingsPanel}
            </div>
            <div hidden={mobileTab !== "ideas"}>{panels.ideasPanel}</div>
            <div hidden={mobileTab !== "review"}>
              <ReviewScreen tasks={tasks} onOpen={(t) => setOpenExistingTaskId(t.id)} />
            </div>
          </MobileShell>
        </>
      ) : (
        <>
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
          {/* Одна строка на любом мониторе — кегль цитата подбирает себе
              сама, замером. На телефоне её нет вовсе: там своя шапка
              (MobileHeader), и эта ветка не отрисовывается. */}
          <HeaderQuote />
          <div className="header-btns">
            {/* Search and notifications are icons only: the words were the
                widest thing in the header and said nothing the magnifier and
                the bell don't. The label lives in title/aria-label, so the
                hover tooltip and a screen reader still name the button.
                Сами значки — контурные (Icon.tsx), а не эмодзи: цветную
                наклейку из системного шрифта рисует не трекер, и рядом со
                словом в шрифте интерфейса она выглядит приклеенной. */}
            <button className="btn btn-icon" id="searchBtn" title="Поиск по трекеру (/)" aria-label="Поиск по трекеру" onClick={() => setSearchOpen(true)}>
              <Icon name="search" size={15} />
            </button>
            {notifications.permission !== "unsupported" && (
              <button
                className={"btn btn-icon" + (notifications.permission === "granted" ? " active" : "")}
                id="notifPermBtn"
                // Granted is a dead end — the browser ignores a second
                // request — so the bell stops being a button and just
                // reports that notifications are on.
                disabled={notifications.permission === "granted"}
                title={
                  notifications.permission === "granted"
                    ? "Уведомления включены"
                    : notifications.permission === "denied"
                      ? "Уведомления запрещены в настройках браузера для этого сайта"
                      : "Включить уведомления"
                }
                aria-label={notifications.permission === "granted" ? "Уведомления включены" : "Включить уведомления"}
                onClick={notifications.requestPermission}
              >
                <Icon name={notifications.permission === "granted" ? "bell" : "bell-off"} size={15} />
              </button>
            )}
            {installPrompt.visible && (
              <button className="btn btn-primary" id="installAppBtn" onClick={installPrompt.promptInstall}>
                <Icon name="install" /> Установить
              </button>
            )}
            {!sameLayout(panelLayout, DEFAULT_PANEL_LAYOUT) && (
              <button
                className="btn"
                id="resetLayoutBtn"
                title="Панели вернутся на исходные места"
                onClick={() => actions.savePanelLayout(DEFAULT_PANEL_LAYOUT)}
              >
                <Icon name="reset" /> Сбросить расположение
              </button>
            )}
            {/* «Команда» и выгрузка — админское: приглашения, отключение
                доступа, отвязка мессенджера и весь архив пространства
                принадлежат владельцу. Руководителю их не показывают, и
                база отказала бы ему в них всё равно (миграции 0019, 0031). */}
            {isAdmin && (
              <>
                <button className="btn" id="teamBtn" title="Кто на связи в мессенджерах" onClick={() => setTeamOpen(true)}>
                  <Icon name="users" /> Команда
                </button>
                <ExportMenu tasks={tasks} meetings={meetings} ideas={ideas} sections={sections} assignees={assignees} />
              </>
            )}
            {botLink.needs.telegram && (
              <button className="btn" id="telegramLinkBtn" onClick={() => botLink.link("telegram")}>
                <Icon name="link" /> Telegram
              </button>
            )}
            {botLink.needs.max && (
              <button className="btn" id="maxLinkBtn" onClick={() => botLink.link("max")}>
                <Icon name="link" /> MAX
              </button>
            )}
            <button className="btn" id="signOutBtn" onClick={() => actions.signOut()}>
              Выйти
            </button>
          </div>
        </div>
      </header>
      {/* Первым, до всего остального: это единственное на экране, чего
          ждут ОТ НЕГО, а не он от других. Ниже — его собственный трекер,
          такой же, как у Кирилла. */}
      {assignedToMe}
      <DashboardLayout
        layout={panelLayout}
        onLayoutChange={actions.savePanelLayout}
        panels={panels}
      />
        </>
      )}
    </>
  );
}
