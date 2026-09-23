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
import TrackerDnd from "@/components/tracker/dnd/TrackerDnd";
import TaskCard from "@/components/tracker/TaskCard";
import type { DragPayload } from "@/components/tracker/dnd/TrackerDnd";
import { pad, todayStr } from "@/lib/taskDisplay";
import { uid } from "@/lib/uid";
import { assignExecutorsByName } from "@/lib/assignWork";
import { formatIdeaCreatedAt } from "@/lib/trackerRows";
import type { Meeting, MeetingPrefill, Task, TaskPrefill } from "@/types/tracker";
import QuickAdd, { type QuickAddProvider } from "@/app/QuickAdd";
import { mergeResult } from "@/lib/meetingLink";
import SearchOverlay from "@/components/tracker/SearchOverlay";
import TeamModal from "@/components/tracker/TeamModal";
import MobileShell, { DEFAULT_MOBILE_TAB, type MobileTab } from "@/components/tracker/MobileShell";
import LoadModal from "@/components/tracker/LoadModal";
import { peopleLoad } from "@/lib/peoplePanel";
import MobileHeader from "@/components/tracker/MobileHeader";
import HeaderQuote from "@/components/tracker/HeaderQuote";
import TodayScreen from "@/components/tracker/TodayScreen";
import ReviewScreen, { awaitingReview } from "@/components/tracker/ReviewScreen";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useWorkspaceRole, MEMBER_ROLE_LABELS } from "@/hooks/useWorkspaceRole";
import { useTaskParticipants } from "@/hooks/useTaskParticipants";
import ActionMenu from "@/components/tracker/ActionMenu";
import { withoutSelfMark } from "@/lib/actorName";
import { bumpVoteRoundIfMoved } from "@/lib/meetingRound";
import MessengerLink from "@/components/tracker/MessengerLink";
import { useMyMessenger } from "@/hooks/useMyMessenger";
import { buildToday, todayCount } from "@/lib/todayScreen";
import type { SearchResult } from "@/lib/localSearch";
import Icon from "@/components/tracker/Icon";
import BootSkeleton from "@/components/tracker/BootSkeleton";
import { isMine, isCreatedByMe } from "@/lib/ownership";
import { isTaskVisible, isMeetingVisible } from "@/lib/itemVisibility";
import { withViewTransition } from "@/lib/viewTransition";

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
  // Две разные границы, и путать их нельзя. isAdmin — структура трекера
  // (разделы и ответственные за них); её Кирилл может кому-то отдать.
  // isOwner — «Команда»: доступ в трекер, приглашения и раздача ролей,
  // и это остаётся за ним одним.
  const isAdmin = identity.isAdmin;
  const isOwner = identity.isOwner;
  // Пусто у владельца — и это не мелочь.
  //
  // Правило «своё» сравнивает created_by с этим id, а у всего, что завёл
  // владелец, created_by в базе пуст: колонка появилась вместе с
  // многопользовательской частью и его собственные строки не помечает.
  // Передать сюда его настоящий id значит объявить чужой всю его работу —
  // и запретить ему закрыть собственную задачу. Пустая строка означает
  // «всё моё», и это ровно правда для владельца пространства.
  const mineOnlyId = identity.role === "manager" ? identity.userId : "";
  // Пересоздаётся только при смене роли: объект уходит в ссылку внутри
  // слоя данных, и новая ссылка на каждый рендер гоняла бы эффект впустую.
  const workspace = useMemo(
    () => ({ ownerId: identity.ownerId, userId: identity.userId, isManager: identity.role === "manager" }),
    [identity.ownerId, identity.userId, identity.role],
  );
  const { loading, loadError, tasks, meetings, ideas, sections, assignees, syncStatus, offline, actions } =
    useTrackerData({ enabled: ready, workspace });
  // Мысль — личная заметка, а не общий поток: 23.09.2026 Кирилл сказал
  // прямо, что видеть чужие задачи и встречи никто не должен, «чтобы не
  // засорялся эфир» — и мысли этому правилу не следовали вовсе. `useTrackerData`
  // читает мысли всего пространства разом (это нужно синку), а сюда до сих
  // пор уходил весь массив без единого фильтра: любая чужая мысль была
  // видна каждому с кнопкой «В работу», отправляли её ему или нет — своего
  // получателя мысль не хранит вовсе. `isMine()` здесь не подходит: она
  // отвечает на вопрос «можно править», а не «видно ли», и для владельца
  // возвращает true безусловно — тем самым объявила бы своими вообще все
  // мысли пространства. `isCreatedByMe()` (lib/ownership.ts) — та же
  // проверка, что теперь и у задач со встречами ниже: сравнивает
  // `createdBy` буквально, без поблажки владельцу.
  const myIdeas = useMemo(() => ideas.filter((i) => isCreatedByMe(i, mineOnlyId)), [ideas, mineOnlyId]);
  // Как меня зовут в списке людей. Своя строка помечена «(я)» — другого
  // способа связать логин с человеком в браузере нет. Нужно на экране
  // «Сегодня», чтобы отличить «моя задача» от «я поручил её другому».
  const myName = assignees.find((a) => a.trim().endsWith("(я)")) || "";

  // То же правило видимости, что у мыслей выше, — только для задач и
  // встреч оно устроено сложнее, потому что «моё» не сводится к одному
  // `createdBy`: у задачи есть ещё исполнитель, соисполнители и
  // наблюдатели, а у встречи — приглашённые. `useTaskParticipants()` уже
  // существовал и жил внутри `TasksPanel` — поднят сюда, чтобы посчитать
  // видимость ОДИН раз и раздать готовый список во все панели разом
  // (доску, встречи, календарь, поиск, «Сегодня», «На приёмке», счётчики
  // на вкладках телефона), а не изобретать это в каждой заново. Второй
  // вызов хука внутри `TasksPanel` остаётся — ему ещё нужны сами действия
  // (принять, отчитаться, приёмка), которых этот верхний слой не просит;
  // два канала подписки на одну таблицу здесь и раньше считались терпимой
  // ценой против «белого экрана» (см. комментарий в самом хуке).
  const participants = useTaskParticipants();
  const visibleTasks = useMemo(
    () =>
      tasks.filter((t) =>
        isTaskVisible(
          t,
          mineOnlyId,
          identity.assigneeId,
          participants.forTask(t.id).map((p) => p.assigneeId),
        ),
      ),
    [tasks, mineOnlyId, participants, identity.assigneeId],
  );
  const visibleMeetings = useMemo(
    () => meetings.filter((m) => isMeetingVisible(m, mineOnlyId, myName)),
    [meetings, mineOnlyId, myName],
  );
  // «На приёмке» — не «видно мне», а «ждёт РОВНО МЕНЯ»: соисполнитель или
  // наблюдатель на чужой задаче видит её на доске, но решение не за ним, и
  // список приёмки не должен предлагать ему решать чужое. `isMine()` здесь
  // тоже не годится по той же причине, что и выше: владельцу она сказала
  // бы «моё поручение» о вообще любой видимой задаче, включая ту, где он
  // сам просто наблюдатель.
  const myReviewTasks = useMemo(() => visibleTasks.filter((t) => isCreatedByMe(t, mineOnlyId)), [visibleTasks, mineOnlyId]);
  const isMobile = useIsMobile();
  const toasts = useToasts();
  const dateTimeConfirm = useDateTimeConfirm();
  const notifications = useNotifications({
    tasks: visibleTasks,
    meetings: visibleMeetings,
    saveTask: actions.saveTask,
    showToast: toasts.showToast,
    ready: !loading,
  });
  const installPrompt = useInstallPrompt();
  const botLink = useBotLink();
  // Свой мессенджер руководителя: у владельца эту роль играет botLink
  // (его чат живёт в telegram_accounts), а у руководителя — собственная
  // строка в списке людей, куда бот шлёт задачи и кнопки. С пустым id хук
  // молчит, поэтому у владельца он ничего не стоит.
  const myMessenger = useMyMessenger(identity.role === "manager" ? identity.assigneeId : "");
  const messengerMissing =
    identity.role === "manager" && !myMessenger.loading && !myMessenger.telegram.connected && !myMessenger.max.connected;

  const [clockText, setClockText] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setClockText(formatClock(new Date())), 30000);
    return () => clearInterval(timer);
  }, []);

  // The calendar and the ideas panel used to have header toggles (legacy's
  // calOpen/ideasOpen). They are always on now: he never hid them, and the
  // two buttons were only taking room away from the header.

  // Четвёртый столбец доски — «Завершённые». Раньше этот же флаг
  // подмешивал закрытые встречи и вычеркнутые мысли в их панели; теперь у
  // каждой из них своя иконка и своё окно, а здесь остался ровно столбец.
  const [showDone, setShowDone] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [openTaskRequest, setOpenTaskRequest] = useState<TaskPrefill | null>(null);
  const [openMeetingRequest, setOpenMeetingRequest] = useState<MeetingPrefill | null>(null);
  const [justCreatedTaskId, setJustCreatedTaskId] = useState<string | null>(null);
  const [justCreatedMeetingId, setJustCreatedMeetingId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  // Сессия начинается с задач — см. DEFAULT_MOBILE_TAB.
  const [mobileTab, setMobileTab] = useState<MobileTab>(DEFAULT_MOBILE_TAB);
  // Разбор фразы голосом: на телефоне это лист снизу, и открывает его
  // строка в меню шапки, а не собственная круглая кнопка (см. QuickAdd).
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Круглая «+» нажата в разделе мыслей: заводить там нечего, поэтому
  // «создать» значит «поставить курсор в поле» (см. IdeasPanel).
  const [ideaFocusSignal, setIdeaFocusSignal] = useState(0);
  // «Загрузка» — у кого что горит. На компьютере её открывает кнопка в
  // полосе над доской; на телефоне полоса сведена к трём кнопкам по слову
  // Кирилла, и эта из неё ушла. Совсем терять её нельзя: «к кому идти
  // первым» — вопрос, который задают как раз не за столом. Поэтому она
  // строкой в меню шапки, там же, где поиск.
  const [loadOpen, setLoadOpen] = useState(false);
  const [openExistingTaskId, setOpenExistingTaskId] = useState<string | null>(null);
  const [openExistingMeetingId, setOpenExistingMeetingId] = useState<string | null>(null);
  const [highlightIdeaId, setHighlightIdeaId] = useState<string | null>(null);
  // Один фильтр на панель задач и панель «Люди»: нажатие на человека и
  // выбор в списке — это один и тот же вопрос, заданный двумя способами.
  const [filterAssignee, setFilterAssignee] = useState("all");
  // Кто сейчас смотрит на трекер — своя строка в шапке, с меню личного
  // кабинета. Слова Кирилла 23.09.2026: «чтоб каждый видел, что они сидят
  // под личным аккаунтом в системе». Без этого экран у всех четырнадцати
  // выглядел одинаково, и «Выйти» была единственной подсказкой, что вход
  // вообще персональный.
  const [accountMenuAnchor, setAccountMenuAnchor] = useState<DOMRect | null>(null);

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
  function convertIdeaToTask(ideaId: string) {
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
      // Колонка `term` в базе осталась, но смысла у неё больше нет:
      // столбец задачи выводится из её состояния (lib/kanban). Пишем
      // «short», чтобы не оставлять поле пустым в строке.
      term: "short",
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
    const task = visibleTasks.find((t) => t.id === taskId);
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
      // Получас по умолчанию: мысль, ставшая встречей, не несёт с собой
      // длительности, а сетка времени идёт получасом.
      durationMin: 30,
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
        // Приоритета в трекере больше нет — колонка осталась в базе, и
        // новые строки просто пишут в неё обычное значение.
        priority: "med",
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
        durationMin: f.durationMin || 30,
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
      const meeting = visibleMeetings.find((m) => m.id === id);
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

  // То, что едет под курсором.
  const renderDragOverlay = (active: DragPayload) => {
    // Карточка поднимается целиком: она размером с то место,
    // куда её несут, и человек видит ровно то, что кладёт. Участники и
    // прогресс сюда не передаются нарочно — они живут в панели задач, а
    // карточка едет доли секунды.
    if (active.kind === "task") {
      const task = visibleTasks.find((t) => t.id === active.id);
      if (!task) return null;
      return (
        <div className="dnd-card-ghost">
          <TaskCard
            task={task}
            section={sections.find((s) => s.id === task.sectionId) ?? null}
            onToggleDone={() => {}}
            onOpen={() => {}}
          />
        </div>
      );
    }
    if (active.kind === "idea") {
      return <div className="dnd-ghost dnd-ghost-idea">{active.text}</div>;
    }
    if (active.kind === "meeting") {
      return <div className="dnd-ghost">{active.title}</div>;
    }
    return null;
  };

  const panels = {
        calPanel: (
          <CalendarPanel
            tasks={visibleTasks}
            meetings={visibleMeetings}
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
            myUserId={mineOnlyId}
            meId={identity.assigneeId}
            meetings={visibleMeetings}
            // Только для проверки занятости слотов в форме встречи — см.
            // комментарий у пропа в самом MeetingsPanel.tsx.
            allMeetings={meetings}
            assignees={assignees}
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
            // Задача, принесённая в блок встреч, — то же самое, что задача,
            // положенная на сегодняшний день календаря, и делается это той
            // же функцией: форма встречи, заполненная по задаче, а сама
            // задача остаётся на доске. День берётся выбранный, а нет
            // выбранного — сегодняшний; поправить его можно прямо в форме.
            onTaskDropped={(id) => taskDroppedOnDate(id, selectedDate ?? todayStr())}
            justCreatedId={justCreatedMeetingId}
          />
        ),
        mainCol: (
          <TasksPanel
            isAdmin={isAdmin}
            myUserId={mineOnlyId}
            myMemberAssigneeId={identity.assigneeId}
            ownerId={identity.ownerId}
            filterAssignee={filterAssignee}
            onFilterAssigneeChange={setFilterAssignee}
            tasks={visibleTasks}
            // Только для «Загрузки» (кто чем занят) — решение объяснено у
            // самого пропа в TasksPanel.tsx: делегируя новую задачу, нужно
            // видеть занятость ЛЮБОГО человека, а не только тех, с кем уже
            // связан общей работой.
            allTasks={tasks}
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
              offline && (
                <div className="notif-banner show" id="offlineBanner">
                  <span>📴 Нет связи с облаком — показываю сохранённую копию. Всё, что записываете, отправится, как только связь вернётся.</span>
                </div>
              )
            }
          />
        ),
        // Панелей «Сегодня» и «Неделя» здесь больше нет.
        //
        // Кирилл о них 19.09.2026: «я вообще не понимаю смысловой
        // нагрузки и зачем ты их сделал… объясни, как это должно помочь,
        // если нету объяснений — удаляй». Объяснения не нашлось: обе
        // отвечали на вопрос «что назначено на день», на который слева
        // отвечает календарь, — и отвечали хуже, потому что показывали то
        // же самое списком и занимали высоту правой колонки. «Сегодня»
        // остался там, где он действительно нужен, — на телефоне,
        // отдельной вкладкой: там трёх столбцов нет вовсе.
        //
        // Панели «Загрузка» здесь тоже больше нет, по его же слову
        // 20.09.2026: «а оттуда этот блок убери, он мешает». Список «у
        // кого что горит» не смотрят постоянно — его открывают, когда
        // задались вопросом, — и теперь он окно под кнопкой «Загрузка» в
        // полосе над доской (LoadModal). Заодно он появился на телефоне,
        // где правой колонки нет вовсе.
        ideasPanel: (
          <IdeasPanel
            myUserId={mineOnlyId}
            ideas={myIdeas}
            highlightId={highlightIdeaId}
            actions={actions}
            toasts={toasts}
            onConvertToTask={convertIdeaToTask}
            onConvertToMeeting={convertIdeaToMeeting}
            focusAddSignal={ideaFocusSignal}
          />
        ),
  };
  // Раздела «Что от вас ждут» здесь больше нет, и это решение Кирилла,
  // сказанное прямо 19.09.2026: «этот первичный функционал думаю вообще
  // убрать, он глупо построен и не продуман тобой… супер не удобный для
  // использования, мне подключённые Козлов и Витовский сразу пожаловались…
  // у всех пользователей окно должно сразу быть как у меня».
  //
  // Он был вторым местом, где живёт одна и та же работа: списком-обрубком
  // наверху и настоящей карточкой в столбце. Теперь всё, что от человека
  // ждут, стоит в самой задаче и в самой встрече — TaskAnswer и
  // MeetingAnswer, — и трекер у всех действительно один и тот же.

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
  // Пока роль и данные едут — каркас трекера, а не слово в углу пустого
  // экрана (см. BootSkeleton: он и есть ответ на «чёрный экран и
  // „Загрузка…“»). Каркас уходит в серверный HTML, то есть виден до
  // того, как выполнится первая строчка JavaScript.
  if (identity.loading || loading) return <BootSkeleton />;

  return (
    <>
      <ToastStack toasts={toasts.toasts} onUndo={toasts.undo} onDismiss={toasts.dismiss} />
      {dateTimeConfirm.dialog}
      <QuickAdd provider={quickAddProvider} sheetOpen={quickAddOpen} onCloseSheet={() => setQuickAddOpen(false)} />
      {teamOpen && isOwner && <TeamModal onClose={() => setTeamOpen(false)} />}
      {searchOpen && (
        <SearchOverlay
          tasks={visibleTasks}
          meetings={visibleMeetings}
          ideas={myIdeas}
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
      {/* Напоминание подключить мессенджер — плавающая карточка (см.
          .ms-link в tracker.css), общая для компьютера и телефона: до
          23.09.2026 она стояла только в десктопной ветке ниже, и
          руководитель, открывший трекер с телефона, о ней не узнавал вовсе. */}
      {messengerMissing && <MessengerLink messenger={myMessenger} />}
      <SyncErrorBanner />
      {isMobile ? (
        <>
          {/* Одна кнопка в шапке, и её меню — единственное место, куда
              сложено всё редкое. Поиск стоит первым после «Команды»:
              лупа, занимавшая половину свободного места в шапке, ушла
              вместе со второй кнопкой (см. MobileHeader).
              Эмодзи в подписях заменены контурными значками: строки стоят
              столбиком, и цветная наклейка от системы рядом со словом
              выглядит приклеенной. */}
          <MobileHeader
            clockText={clockText}
            accountName={withoutSelfMark(myName)}
            items={[
              ...(isOwner ? [{ id: "team", label: "Команда", icon: "users" as const, onSelect: () => setTeamOpen(true) }] : []),
              // Поиска здесь больше нет: он переехал в нижнюю панель
              // шестой кнопкой (22.09.2026, «поиск в нижнюю панель»). В
              // меню шапки он стоил двух нажатий и находился в углу,
              // противоположном большому пальцу, — а ищут с телефона чаще
              // всего остального.
              // Только когда есть кому быть загруженным: строка меню,
              // открывающая окно со словами «никому ничего не поручено», —
              // это строка, после которой ничего не произошло.
              ...(peopleLoad(tasks, assignees).length > 0
                ? [{ id: "load", label: "Загрузка — у кого что горит", icon: "users" as const, onSelect: () => setLoadOpen(true) }]
                : []),
              // Разбор фразы голосом — то, ради чего у быстрого ввода была
              // своя круглая кнопка. Кнопку забрали разделы (пункт 7), а
              // сам разбор остался и открывается отсюда.
              { id: "voice", label: "Записать голосом", icon: "mic" as const, onSelect: () => setQuickAddOpen(true) },
              ...(notifications.permission !== "unsupported"
                ? [
                    {
                      id: "notif",
                      label: notifications.permission === "granted" ? "Уведомления включены" : "Включить уведомления",
                      icon: notifications.permission === "granted" ? ("bell" as const) : ("bell-off" as const),
                      onSelect: notifications.requestPermission,
                      disabled: notifications.permission === "granted",
                    },
                  ]
                : []),
              ...(installPrompt.visible ? [{ id: "install", label: "Установить приложение", icon: "install" as const, onSelect: installPrompt.promptInstall }] : []),
              // Привязка чата к учётной записи — владельцева. У руководителя
              // свой путь, полосой над доской: его чат живёт в строке человека,
              // а не в аккаунте (см. MessengerLink и useMyMessenger).
              ...(isOwner && botLink.needs.telegram ? [{ id: "tg", label: "Подключить Telegram", icon: "link" as const, onSelect: () => botLink.link("telegram") }] : []),
              ...(isOwner && botLink.needs.max ? [{ id: "max", label: "Подключить MAX", icon: "link" as const, onSelect: () => botLink.link("max") }] : []),
              { id: "signout", label: "Выйти", icon: "logout" as const, onSelect: () => actions.signOut() },
            ]}
          />
          <MobileShell
            tab={mobileTab}
            // Плавно, а не рывком: на телефоне смена вкладки — это весь
            // экран целиком, и мгновенная подмена читается как перезагрузка.
            onTabChange={(tab) => withViewTransition(() => setMobileTab(tab))}
            onSearch={() => setSearchOpen(true)}
            badges={{
              today: todayCount(buildToday(visibleTasks, visibleMeetings)),
              meetings: visibleMeetings.filter((m) => !m.status || m.status === "planned").length,
              ideas: myIdeas.filter((i) => !i.done).length,
              review: awaitingReview(myReviewTasks).length,
            }}
          >
            {/* Every section stays mounted and is merely hidden: switching tabs
                keeps scroll position and open editors, and the modals inside
                them are portalled to <body>, so they show over the shell. */}
            <div hidden={mobileTab !== "today"}>
              <TodayScreen
                tasks={visibleTasks}
                meetings={visibleMeetings}
                sections={sections}
                // Правило галочки здесь то же, что на доске: закрывает
                // задачу постановщик, а не тот, кому она поручена. И если
                // делает её другой человек, закрытие требует результата —
                // значит не галочкой, а карточкой, где есть приёмка и
                // волевое закрытие. Исполнители известны панели задач, а
                // не этому экрану, поэтому здесь сравнивается имя в поле
                // «Исполнитель»: приближение в сторону строгости, то есть
                // лишний раз откроется карточка, а не закроется молча
                // чужая работа.
                canCompleteTask={(task) => isMine(task, mineOnlyId)}
                onToggleTask={(task) => {
                  const someoneElse = task.status !== "done" && !!task.assignee && task.assignee !== myName;
                  if (someoneElse) {
                    setOpenExistingTaskId(task.id);
                    toasts.showToast("Нужен результат", "Задачу делает другой человек — закройте её в карточке, написав, что сделано.");
                    return;
                  }
                  actions.saveTask({ ...task, status: task.status === "done" ? "in_progress" : "done", completedAt: task.status === "done" ? "" : new Date().toISOString() });
                }}
                onOpenTask={(task) => setOpenExistingTaskId(task.id)}
                onOpenMeeting={(meeting) => setOpenExistingMeetingId(meeting.id)}
                // Чтобы карточка знала, кем я в ней числюсь, и красилась
                // тем же тоном, что на доске.
                myAssigneeId={identity.assigneeId}
                onGoToTasks={() => setMobileTab("tasks")}
                showToast={toasts.showToast}
              />
            </div>
            <div hidden={mobileTab !== "tasks"}>{panels.mainCol}</div>
            {/* Календаря месяца здесь больше нет. Слова Кирилла
                20.09.2026: «в разделе „встречи“ убрать календарь, в
                мобильной версии он хавает слишком много пространства».
                Тридцать клеток занимали первый экран целиком, а отвечали
                на то, на что под ними отвечает сам список встреч — где
                дата написана словами и стоит на карточке. Выбрать день
                по-прежнему можно там, где это и нужно: в форме встречи. */}
            <div hidden={mobileTab !== "meetings"}>{panels.meetingsPanel}</div>
            <div hidden={mobileTab !== "ideas"}>{panels.ideasPanel}</div>
            <div hidden={mobileTab !== "review"}>
              <ReviewScreen tasks={myReviewTasks} onOpen={(t) => setOpenExistingTaskId(t.id)} />
            </div>
          </MobileShell>
          {/* Круглая «+» заводит то, в каком разделе её нажали.
              Слова Кирилла 20.09.2026: «если в разделе задачи → ЗАДАЧУ,
              если в разделе встречи → ВСТРЕЧУ и с мыслями так же». До
              этого она открывала разбор фразы — одинаковый во всех пяти
              разделах, то есть кнопка, которая не знает, где стоит.
              В «Сегодня» и «Приёмке» её нет вовсе: заводить там нечего,
              а кнопка, заводящая задачу из очереди приёмки, отвечала бы
              не на тот вопрос, с которым туда заходят. */}
          {(mobileTab === "tasks" || mobileTab === "meetings" || mobileTab === "ideas") && (
            <button
              type="button"
              className="quick-add-fab"
              aria-label={mobileTab === "tasks" ? "Новая задача" : mobileTab === "meetings" ? "Новая встреча" : "Новая мысль"}
              onClick={() => {
                if (mobileTab === "tasks") setOpenTaskRequest({});
                else if (mobileTab === "meetings") setOpenMeetingRequest({ date: selectedDate ?? todayStr() });
                else setIdeaFocusSignal((n) => n + 1);
              }}
            >
              <Icon name="plus" size={26} />
            </button>
          )}
          {loadOpen && (
            <LoadModal
              tasks={tasks}
              assignees={assignees}
              selected={filterAssignee}
              onSelect={setFilterAssignee}
              onClose={() => setLoadOpen(false)}
            />
          )}
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
            {/* Ни кнопки «Сбросить расположение», ни самого расположения
                здесь больше нет: раскладка жёсткая (см. DashboardLayout).
                Сначала ушла кнопка — «не понимаю смысл кнопки… конструктор
                должен легко меняться, чтобы эта кнопка вообще не
                требовалась», — а следом и конструктор: «первым делом
                убираем возможность переносить блоки, они всё же должны быть
                статичны». */}
            {/* «Команда» — владельцева, и остаётся такой даже теперь, когда
                администратором может быть кто-то ещё (миграция 0036):
                приглашения, отключение доступа, отвязка мессенджера и
                раздача самих ролей — это доступ в трекер, а его раздаёт тот,
                чьё пространство. База отказала бы всё равно (миграция 0019). */}
            {isOwner && (
              <button className="btn" id="teamBtn" title="Кто на связи в мессенджерах" onClick={() => setTeamOpen(true)}>
                <Icon name="users" /> Команда
              </button>
            )}
            {/* Только владельцу: см. комментарий у того же условия в меню
                телефона — руководителю эти кнопки привязали бы чат не туда. */}
            {isOwner && botLink.needs.telegram && (
              <button className="btn" id="telegramLinkBtn" onClick={() => botLink.link("telegram")}>
                <Icon name="link" /> Telegram
              </button>
            )}
            {isOwner && botLink.needs.max && (
              <button className="btn" id="maxLinkBtn" onClick={() => botLink.link("max")}>
                <Icon name="link" /> MAX
              </button>
            )}
            {/* Личный кабинет: имя того, кто сейчас вошёл, плюс меню с
                «Выйти». «Выйти» стояло отдельной кнопкой и ничего не
                говорило о том, ЧЕЙ это вход — при четырнадцати
                постановщиках это первый вопрос к своей же шапке. */}
            <button
              className="btn account-btn"
              id="accountBtn"
              title="Личный кабинет"
              onClick={(e) => setAccountMenuAnchor(e.currentTarget.getBoundingClientRect())}
            >
              <Icon name="users" size={14} /> {withoutSelfMark(myName) || "Аккаунт"}
            </button>
          </div>
        </div>
      </header>
      {accountMenuAnchor && (
        <ActionMenu
          anchor={accountMenuAnchor}
          title={MEMBER_ROLE_LABELS[identity.memberRole]}
          items={[{ id: "signout", label: "Выйти", icon: "logout", onSelect: () => actions.signOut() }]}
          onClose={() => setAccountMenuAnchor(null)}
        />
      )}
      {/* Мессенджер — первое, чего не хватает человеку, который вошёл по
          приглашению: без него задачи, напоминания и кнопки «Принял /
          Сделал» приходят только сюда, а сюда он заходит не каждый день.
          Напоминание теперь общее для обеих раскладок — см. плавающую
          карточку MessengerLink выше, до ветки isMobile/desktop. */}
      {/* Перетаскивание — одно на весь трекер: панели, задачи, мысли и
          встречи ездят в одном контексте, потому что ездят они друг в
          друга. Разбор «что куда бросили» живёт там же. */}
      <TrackerDnd renderOverlay={renderDragOverlay}>
        <DashboardLayout panels={panels} />
      </TrackerDnd>
        </>
      )}
    </>
  );
}
