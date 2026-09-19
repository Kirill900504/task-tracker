"use client";

// Port of the task columns + toolbar from public/legacy-tracker.js
// (render(), matchesFilters(), sortFn/rankOf, the modal open/save/delete
// flow, setupTaskDragDrop()/reorderColumn(), and the idea-drop handlers
// for elListShort/elListLong).
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Section, Task, TaskPrefill } from "@/types/tracker";
import { isOverdue, isTaskDueOnDate, taskSortFn } from "@/lib/taskDisplay";
import { insertBefore, moveWithin } from "@/lib/dndOrder";
import { useDragState, useDropHandler, type DropTarget } from "./dnd/TrackerDnd";
import { SortableTask, TaskColumnBody } from "./dnd/SortableTask";
import TaskCard from "./TaskCard";
import type { ActionMenuItem } from "./ActionMenu";
import TaskModal from "./TaskModal";
import SendMenu from "./SendMenu";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useTaskParticipants } from "@/hooks/useTaskParticipants";
import { progressLabel, taskStage } from "@/lib/taskProgress";
import type { useToasts } from "@/hooks/useToasts";
import PanelDragHandle, { resolveDragHandleProps, type PanelDragProps } from "./PanelDragHandle";
import SectionTabs from "./SectionTabs";
import Dropdown from "./Dropdown";
import { useAsk } from "@/components/Ask";
import { uid } from "@/lib/uid";
import { sortNames } from "@/lib/peopleOrder";
import Icon from "./Icon";
import { isMine } from "@/lib/ownership";
import { useAuthors } from "@/hooks/useAuthors";

type Term = "short" | "long";

// Спорит ли срок со столбцом, в который задачу только что перенесли.
//
// Дата и срочность — два разных ответа на «когда»: дата говорит, к какому
// числу, срочность — в каком темпе этим заниматься. Обычно они согласованы,
// и как раз поэтому расхождение стоит назвать вслух: долгосрочная задача со
// сроком через три дня будет висеть в столбце, куда смотрят раз в неделю, а
// краткосрочная со сроком через полгода — мозолить глаза каждый день.
// Ничего не исправляется само: сказать — достаточно, решает Кирилл.
const SOON_DAYS = 14;

function deadlineNote(deadline: string, term: Term): string {
  if (!deadline) return "";
  const due = new Date(deadline + "T00:00:00");
  if (Number.isNaN(due.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (term === "long" && days <= SOON_DAYS) {
    return days < 0 ? "Срок уже прошёл — проверьте, не пора ли его сдвинуть" : `Срок через ${days} дн. — короткий для долгосрочной`;
  }
  if (term === "short" && days > SOON_DAYS) {
    return `Срок через ${days} дн. — долгий для краткосрочной`;
  }
  return "";
}

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
  onScheduleMeetingFor,
  isAdmin = true,
  myUserId = "",
  filterAssignee,
  onFilterAssigneeChange,
  justCreatedId,
  notifBanner,
  extraBanner,
  dragHandleProps,
  isDragging,
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
  // То же самое из формы задачи, где известен и полный состав участников.
  onScheduleMeetingFor?: (task: Task, participants: string[]) => void;
  // Разделы и принудительное закрытие — админское: их держит владелец
  // пространства, и база откажет остальным (миграция 0031).
  isAdmin?: boolean;
  // Свой auth-id: по нему отличается «моя задача» от «чужой, которую мне
  // видно». У владельца пусто — ему принадлежит всё в его пространстве.
  myUserId?: string;
  // Фильтр по исполнителю живёт снаружи: тот же выбор делает панель
  // «Люди», и две копии одного состояния разошлись бы в первый же день.
  filterAssignee: string;
  onFilterAssigneeChange: (name: string) => void;
  justCreatedId?: string | null;
  notifBanner?: string | null;
  // Rendered under the notification banner, in the same slot legacy's
  // #syncErrorBanner occupied (see SyncErrorBanner).
  extraBanner?: ReactNode;
} & PanelDragProps) {
  // «Просрочено» — не сортировка и не раздел, а вопрос «что горит»: он
  // задаётся чаще всех прочих фильтров вместе взятых.
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  // «Только мои поручения». Нужен ровно тогда, когда постановщиков стало
  // больше одного: иначе половина списка — чужая работа, о которой видно
  // только то, что она есть.
  const [onlyMine, setOnlyMine] = useState(false);
  const [filterSection, setFilterSection] = useState("all");
  const [modalState, setModalState] = useState<{ open: boolean; task: Task | null; prefill?: TaskPrefill }>({ open: false, task: null });
  const isMobile = useIsMobile();
  // Кто на задаче — один слой на всю панель: и карточки, и форма
  // читают отсюда, чтобы не заводить по подписке на каждую карточку.
  const participants = useTaskParticipants();
  // Кто из логинов какой человек: карточка чужого поручения подписывается
  // именем, а не идентификатором.
  const authors = useAuthors();
  const ask = useAsk();
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

  // The card whose «кому отправить» menu is open (phone only — with a
  // mouse the same thing sits in the task's own form).
  const [sendTask, setSendTask] = useState<Task | null>(null);

  // Что сейчас несут и над чем оно висит — отсюда берётся предпросмотр
  // столбцов: место освобождается ДО того, как карточку отпустили.
  const { active: dragActive, over: dragOver } = useDragState();

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

  // Своё или чужое — одно правило на весь трекер (см. lib/ownership).
  //
  // Объявлено ЗДЕСЬ, выше первого использования, и переносить ниже нельзя.
  // Стояло на сто строк ниже, и почти всё сходило с рук: `mine` зовут из
  // обработчиков и из разметки, а они выполняются, когда тело компонента
  // уже дошло до конца. Одно-единственное место звало его ПРЯМО в теле —
  // строка `tasks.some(...)` ниже, — и она падала с «Cannot access 'mine'
  // before initialization» на каждом рендере, где есть хоть одна задача.
  // У пустого списка `some` не вызывает обработчик ни разу, поэтому новый
  // аккаунт работал ровно до первой задачи, а потом трекер не открывался
  // вовсе. Ни типы, ни линтер этого не видели.
  const mine = (t: Task | null) => isMine(t, myUserId);

  // Цифра на кнопке считается по всем задачам, а не по отфильтрованным:
  // иначе, включив фильтр, она показывала бы сама себя.
  const overdueCount = tasks.filter((t) => isOverdue(t)).length;
  // Есть ли вообще чужие поручения. Пока их нет, фильтр «мои» — кнопка,
  // которая ничего не меняет.
  const someoneElseAssigns = tasks.some((t) => !mine(t));
  // Имя постановщика — только у чужого поручения. Своё подписывать своим же
  // именем значит повторять на каждой карточке то, что и так известно.
  const authorOf = (t: Task) => (mine(t) ? "" : authors[t.createdBy || ""] || "");

  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  const filtered = tasks.filter((t) => {
    if (filterAssignee !== "all" && t.assignee !== filterAssignee) return false;
    if (onlyOverdue && !isOverdue(t)) return false;
    if (onlyMine && !mine(t)) return false;
    if (filterSection !== "all" && (t.sectionId || "") !== filterSection) return false;
    if (calendarFilterDate && !isTaskDueOnDate(t, new Date(calendarFilterDate + "T00:00:00"))) return false;
    return true;
  });
  // На приёмке — это не срок, а состояние, и потому третий столбец, а не
  // метка внутри первых двух. Задача, по которой отчитались все, ждёт одного
  // человека — постановщика; пока она лежит вперемешку с теми, которые
  // делают другие, она теряется среди них, и «отчитался, а он не принял»
  // становится обычным делом. Здесь у неё своё место, и видно, сколько их.
  const stageOf = (t: Task) => taskStage(participants.forTask(t.id), t.approvalState || "open");
  const openTasks = filtered.filter((t) => t.status !== "done");
  const onReview = openTasks.filter((t) => stageOf(t) === "awaiting_review").sort(taskSortFn);
  const reviewIds = new Set(onReview.map((t) => t.id));
  const shortOpen = openTasks.filter((t) => t.term === "short" && !reviewIds.has(t.id)).sort(taskSortFn);
  const longOpen = openTasks.filter((t) => t.term === "long" && !reviewIds.has(t.id)).sort(taskSortFn);
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

  // Новый раздел прямо из строки разделов — тот же вопрос, что и в карточке
  // задачи: сначала название, потом рабочий он или личный.
  async function addSection() {
    const name = await ask.ask({
      title: "Новый раздел",
      question: "Как назовём раздел?",
      placeholder: "Например: Сервис",
      okText: "Дальше",
      required: "У раздела должно быть название.",
    });
    if (!name?.trim()) return;
    const kind = await ask.choose({
      title: "Какой это раздел",
      question: `«${name.trim()}» — рабочий или личный?`,
      note: "Личные разделы не попадают в сводки и отчёты по работе.",
      options: [
        { value: "work", label: "Рабочий" },
        { value: "personal", label: "Личный" },
      ],
    });
    if (kind === null) return;
    actions.saveSection({ id: uid(), name: name.trim(), kind: kind === "personal" ? "personal" : "work", sortOrder: sections.length });
  }

  // Правая кнопка по разделу: переименовать или удалить. Задачи раздел не
  // уносит с собой — они остаются, просто без него.
  async function renameSection(section: Section) {
    const name = await ask.ask({
      title: "Раздел",
      question: "Как он должен называться?",
      value: section.name,
      okText: "Сохранить",
      required: "У раздела должно быть название.",
    });
    if (!name?.trim() || name.trim() === section.name) return;
    actions.saveSection({ ...section, name: name.trim() });
  }

  async function deleteSectionAsked(section: Section) {
    const yes = await ask.confirm({
      question: `Удалить раздел «${section.name}»?`,
      note: "Задачи в нём останутся — они просто будут без раздела.",
      okText: "Удалить",
      danger: true,
    });
    if (!yes) return;
    if (filterSection === section.id) setFilterSection("all");
    removeSection(section.id);
  }

  function toggleDone(t: Task) {
    // Чужую задачу нельзя закрыть за постановщика — и, что важнее, нельзя
    // сделать вид, что закрыл: база откажет молча, галочка проживёт до
    // перезагрузки, а человек будет считать дело сделанным. Отчитаться по
    // ней он может там, где это его дело, — в разделе «Что от вас ждут».
    if (!mine(t)) {
      toasts.showToast("Это не ваша задача", "Отчитаться по ней можно в разделе «Что от вас ждут» — вверху страницы.");
      return;
    }
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

  // Куда встанет задача: цель говорит и столбец, и соседа, перед которым
  // вставать. Одна и та же пара считается и для предпросмотра, и для
  // записи, — иначе они разойдутся (см. lib/dndOrder.ts).
  function columnTargetOf(target: DropTarget): { term: Term; beforeId: string | null } | null {
    if (target.kind === "task-column") return { term: target.term as Term, beforeId: null };
    if (target.kind === "task") return { term: target.term as Term, beforeId: target.id };
    return null;
  }

  function handleTaskDrop(taskId: string, target: DropTarget) {
    const spot = columnTargetOf(target);
    // Не наш случай: задачу могли бросить на день календаря — это разбирает
    // календарь, у него свой обработчик.
    if (!spot) return;
    const dragged = tasks.find((t) => t.id === taskId);
    if (!dragged) return;
    // Чужую задачу не переносят: срочность и порядок — свойства самой
    // задачи, то есть правка, и база откажет молча. Карточка при этом уже
    // «переехала» бы на экране и вернулась после перезагрузки.
    if (!mine(dragged)) {
      toasts.showToast("Это не ваша задача", "Переносить её может только тот, кто поставил.");
      return;
    }

    const term = spot.term;
    const columnList = term === "short" ? shortOpen : longOpen;
    const movedColumns = dragged.term !== term;
    const ids = columnList.map((t) => t.id);
    // Внутри столбца — перестановка на место соседа, в чужой столбец —
    // вставка перед ним. Это разные вещи: см. lib/dndOrder.ts.
    const siblingIds = movedColumns ? insertBefore(ids, taskId, spot.beforeId) : moveWithin(ids, taskId, spot.beforeId);

    siblingIds.forEach((id, i) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      const changedTerm = id === taskId && t.term !== term;
      if (t.manualOrder === i && !changedTerm) return;
      actions.saveTask({ ...t, manualOrder: i, ...(changedTerm ? { term } : {}) });
    });

    // Смена столбца — с отменой, как и всё остальное, что меняет задачу
    // одним движением. Промахнуться мышью мимо своего столбца легко, а
    // понять, куда задача делась, и вернуть её обратно — это уже найти её
    // глазами в соседнем списке и перетащить назад.
    //
    // Перестановка ВНУТРИ столбца тоста не получает: там видно, что
    // произошло, и ничего не пропадает из виду.
    if (movedColumns) {
      const before = dragged;
      toasts.showToast(
        term === "long" ? "Задача теперь долгосрочная" : "Задача теперь краткосрочная",
        // Срок не трогаем: дата — это договорённость с человеком, а не
        // следствие того, в каком столбце лежит карточка, и молча сдвинуть
        // её значило бы решить за Кирилла. Но если после переноса срок
        // спорит со столбцом, об этом стоит сказать — именно это
        // несоответствие потом читается как «почему долгосрочная горит».
        deadlineNote(before.deadline, term) || before.title,
        () => actions.saveTask(before),
      );
    }
  }

  // Мысль, брошенная в столбец задач, становится задачей — это разбирает
  // владелец мыслей, а сюда приходит уже готовым обработчиком.
  function handleIdeaDrop(ideaId: string, target: DropTarget) {
    const spot = columnTargetOf(target);
    if (!spot) return;
    onIdeaDropped(ideaId, spot.term);
  }

  useDropHandler("task", handleTaskDrop);
  useDropHandler("idea", handleIdeaDrop);

  // Столбцы, какими их видно ПРЯМО СЕЙЧАС. Пока карточку несут, она уже
  // стоит на новом месте, а соседи разъехались: это и есть «расступаются,
  // уступая место», о котором просил Кирилл. Отпускание ничего не двигает
  // на экране — оно лишь закрепляет то, что человек уже видит.
  const preview = useMemo(() => {
    const plain = { short: shortOpen, long: longOpen };
    if (dragActive?.kind !== "task" || !dragOver) return plain;
    const spot = dragOver.kind === "task-column" || dragOver.kind === "task" ? columnTargetOf(dragOver) : null;
    if (!spot) return plain;

    const dragged = tasks.find((t) => t.id === dragActive.id);
    if (!dragged) return plain;

    // ВНУТРИ своего столбца предпросмотр не трогает список вообще. Сдвиг
    // соседей там рисует сам sortable — трансформацией, не перестановкой
    // узлов.
    //
    // Это не оптимизация, а лечение зацикливания, от которого у Кирилла
    // 19.09.2026 приложение падало в белый экран, стоило потянуть
    // долгосрочную задачу. Петля такая: вставили карточку перед той, над
    // которой курсор, — под курсором оказалась она сама, — «вставить перед
    // собой» означает «в конец», карточка уехала вниз, под курсором снова
    // прежняя соседка, и всё начинается заново. Каждый круг — перерисовка
    // обоих столбцов, и рендерер умирает за секунды. У меня это не
    // воспроизводилось ровно потому, что в тестовом столбце лежала одна
    // карточка: петле не за что зацепиться.
    if (spot.term === dragged.term) return plain;

    // В ЧУЖОЙ столбец карточка тоже не перепрыгивает — и это второе, что
    // пришлось исправить после живого опыта. Слова Кирилла: «перескакивает
    // резко, нервно, когда перетягиваешь задачи между столбиками». Так и
    // было: карточка исчезала из своего столбца и появлялась в конце
    // чужого, оба столбца меняли высоту разом, и глазу не за что было
    // зацепиться.
    //
    // Теперь на месте карточки остаётся её силуэт, а в чужом столбце
    // ПЛАВНО раскрывается место (`.task-drop-slot`, см. TaskColumnBody).
    // Ничего не переставляется до отпускания — двигается только высота, и
    // движется она сама, переходом CSS.
    return plain;
  }, [shortOpen, longOpen, tasks, dragActive, dragOver]);

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
    // Порядок и срочность — свойства самой задачи, то есть правка. У чужой
    // задачи остаётся только то, что правкой не является: показать её
    // коллеге и собрать по ней встречу.
    const items: ActionMenuItem[] = mine(t)
      ? [
          { id: "top", label: "Наверх списка", icon: "arrow-up", onSelect: () => moveWithinColumn(t, "top") },
          { id: "bottom", label: "В конец списка", icon: "arrow-down", onSelect: () => moveWithinColumn(t, "bottom") },
          {
            id: "term",
            // Moving between columns was also a drag; the modal has the same
            // field, but this is one tap instead of four.
            label: t.term === "short" ? "В долгосрочные" : "В краткосрочные",
            icon: "arrow-right",
            onSelect: () => actions.saveTask({ ...t, term: t.term === "short" ? "long" : "short", manualOrder: null }),
          },
        ]
      : [];
    // «Назначить встречу по задаче» переехала сюда из карточки: в самой
    // карточке заведённой задачи осталось только то, что перечислил Кирилл.
    // Состав берётся с задачи — собираются по ней обычно всем составом, а
    // не с одним человеком из поля.
    if (onScheduleMeetingFor) {
      const people = [...new Set([t.assignee, ...participants.forTask(t.id).filter((p) => p.role !== "watcher").map((p) => p.name)])].filter(Boolean);
      items.push({ id: "meeting", label: "Назначить встречу", icon: "calendar", onSelect: () => onScheduleMeetingFor(t, people) });
    } else if (onTaskToMeeting) {
      items.push({ id: "meeting", label: "Назначить встречу", icon: "calendar", onSelect: () => onTaskToMeeting(t.id) });
    }
    // Sending is in here rather than only in the editor because on a phone
    // «скинуть Ане» should not cost opening a form and closing it again.
    items.push({ id: "send", label: "Отправить коллеге", icon: "send", onSelect: () => setSendTask(t) });
    return items;
  }

  function renderColumn(list: Task[], emptyText: string, countLabel: string, term: Term) {
    const colId = term === "short" ? "colShort" : "colLong";
    const collapsed = collapsedCols[colId];
    return (
      <div className={"column" + (collapsed ? " collapsed" : "")} id={colId}>
        <div className="section-title" onClick={() => toggleCollapsed(colId)}>
          {countLabel} <span className="count">{list.length}</span>
          <span className="collapse-arrow">▾</span>
        </div>
        <TaskColumnBody term={term} ids={list.map((t) => t.id)} empty={list.length === 0}>
          {list.length === 0 ? (
            <div className="empty">{emptyText}</div>
          ) : (
            list.map((t) => (
              <SortableTask key={t.id} task={t} term={term} draggable={mine(t)}>
                {(dragProps, isDragging) => (
                  <TaskCard
                    task={t}
                    section={sectionById.get(t.sectionId) ?? null}
                    progress={progressLabel(participants.forTask(t.id))}
                    stage={taskStage(participants.forTask(t.id), t.approvalState || "open")}
                    onToggleDone={() => toggleDone(t)}
                    onOpen={() => setModalState({ open: true, task: t })}
                    isDragging={isDragging}
                    dragProps={dragProps}
                    justCreated={justCreatedId === t.id}
                    menuItems={isMobile ? menuItemsFor(t) : undefined}
                    authorName={authorOf(t)}
                  />
                )}
              </SortableTask>
            ))
          )}
        </TaskColumnBody>
      </div>
    );
  }

  // Столбец приёмки — читать, а не перетаскивать. Перенести сюда карточку
  // мышью нельзя нарочно: «на приёмке» означает, что все исполнители
  // отчитались, и объявить это перетаскиванием значило бы отчитаться за них.
  function renderReviewColumn() {
    const collapsed = collapsedCols.colReview;
    return (
      <div className={"column column-review" + (collapsed ? " collapsed" : "")} id="colReview">
        <div className="section-title" onClick={() => toggleCollapsed("colReview")}>
          На приёмку <span className="count">{onReview.length}</span>
          <span className="collapse-arrow">▾</span>
        </div>
        <div>
          {onReview.length === 0 ? (
            <div className="empty">Здесь появятся задачи, по которым отчитались все, — их ждёт ваше решение.</div>
          ) : (
            onReview.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                section={sectionById.get(t.sectionId) ?? null}
                progress={progressLabel(participants.forTask(t.id))}
                stage={stageOf(t)}
                onToggleDone={() => toggleDone(t)}
                onOpen={() => setModalState({ open: true, task: t })}
                justCreated={justCreatedId === t.id}
                menuItems={isMobile ? menuItemsFor(t) : undefined}
                authorName={authorOf(t)}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={"main-col dash-panel" + (isDragging ? " dragging" : "")} id="mainCol" data-panel-id="mainCol">
      {notifBanner && (
        <div className="notif-banner show" id="notifBanner">
          {notifBanner}
        </div>
      )}
      {extraBanner}
      {(() => {
        const filtersActive = filterSection !== "all" || filterAssignee !== "all" || onlyOverdue || onlyMine;
        const collapsed = isMobile && !filtersOpen;
        return (
          // Строки с надписью «ЗАДАЧИ» над этой панелью больше нет: она
          // ничего не объясняла (задачи ни с чем не спутать) и стоила
          // высоты. Ручка перетаскивания живёт здесь же, слева от кнопки.
          <div className={"toolbar" + (collapsed ? " collapsed" : "")}>
            <PanelDragHandle {...resolveDragHandleProps(dragHandleProps)} />
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
            <Dropdown
              id="filterAssignee"
              className="toolbar-dd"
              title="Фильтр по исполнителю"
              value={filterAssignee}
              onChange={onFilterAssigneeChange}
              options={[
                { value: "all", label: "Все исполнители" },
                ...sortNames(assignees).map((a) => ({ value: a, label: a })),
              ]}
            />
            {/* Две кнопки вместо списка приоритетов и галочки.
                Фильтр «Любой приоритет» открывали, чтобы найти «Высокий», —
                но высокий приоритет и так виден на карточке цветом, а
                настоящие вопросы к списку другие: «что горит» и «что уже
                сделано». Поэтому просроченное и завершённые — двумя
                нажатиями, и видно, что включено, не открывая ничего. */}
            <button
              type="button"
              className={"filter-pill overdue" + (onlyOverdue ? " active" : "")}
              id="filterOverdueBtn"
              aria-pressed={onlyOverdue}
              onClick={() => setOnlyOverdue((v) => !v)}
            >
              <Icon name="warning" size={14} /> Просрочено
              {overdueCount > 0 && <span className="filter-pill-count">{overdueCount}</span>}
            </button>
            {/* Только там, где поручает не один человек: кнопка, которая
                всегда ничего не меняет, — это кнопка, которую надо объяснять. */}
            {someoneElseAssigns && (
              <button
                type="button"
                className={"filter-pill" + (onlyMine ? " active" : "")}
                id="filterMineBtn"
                aria-pressed={onlyMine}
                title="Показать только то, что поручили вы"
                onClick={() => setOnlyMine((v) => !v)}
              >
                <Icon name="users" size={14} /> Мои поручения
              </button>
            )}
            <button
              type="button"
              className={"filter-pill done" + (showDone ? " active" : "")}
              id="showDoneCheckbox"
              aria-pressed={showDone}
              onClick={() => onShowDoneChange(!showDone)}
            >
              <Icon name="check" size={14} /> Завершённые
            </button>
          </div>
        );
      })()}

      {/* Разделы — кнопками, а не выпадающим списком.
          Раздел выбирают чаще всех прочих фильтров и переключают по многу
          раз подряд; в списке это два нажатия и обязательное чтение всего
          перечня, а здесь видно сразу, что вообще есть и что выбрано. Стоят
          они между кнопкой «Новая задача» и столбцами — там, куда смотрят
          перед тем, как читать сами задачи. */}
      {/* Разделы — кнопками под панелью задач: выбрать, завести новый («+»)
          и переставить, зажав и потянув (см. SectionTabs). */}
      <SectionTabs
        canEdit={isAdmin}
        sections={sections}
        value={filterSection}
        onSelect={setFilterSection}
        onAdd={() => void addSection()}
        onRename={(s) => void renameSection(s)}
        onDelete={(s) => void deleteSectionAsked(s)}
        onReorder={(ids) =>
          ids.forEach((id, i) => {
            const s = sections.find((x) => x.id === id);
            if (s && s.sortOrder !== i) actions.saveSection({ ...s, sortOrder: i });
          })
        }
      />

      <div className="columns">
        {renderColumn(preview.short, "Нет краткосрочных задач по текущим фильтрам", "Краткосрочные", "short")}
        {renderColumn(preview.long, "Нет долгосрочных задач по текущим фильтрам", "Долгосрочные", "long")}
        {renderReviewColumn()}
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
          // Своя задача — та, которую поставил сам. У владельца свои все:
          // пространство его, и колонка created_by у старых задач пуста.
          canEdit={mine(modalTask)}
          task={modalTask}
          prefill={modalPrefill}
          sections={sections}
          onSave={(t, pending) => {
            const wasDeadline = modalTask?.deadline || "";
            actions.saveTask(t);
            // Срок двинули — об этом надо сказать тем, кто под него
            // планировал, и оставить след в хронике задачи. Раньше старая
            // дата просто исчезала: спросить «сколько раз её двигали» было
            // нельзя, а человек узнавал о новом сроке только когда открывал
            // трекер — если открывал.
            //
            // Только у уже заведённой задачи и только когда дата правда
            // изменилась: у новой сообщать нечего, её ещё никто не видел.
            if (modalTask && (t.deadline || "") !== wasDeadline) {
              void fetch("/api/workspace/review", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "deadline", taskId: t.id, date: t.deadline || "", comment: wasDeadline }),
              }).catch(() => {});
            }
            // Задача только что создана — строки участия заводятся и по
            // имени из поля «Исполнитель», и по всем, кого добавили рядом.
            //
            // И если кому-то она не ушла, об этом говорится вслух. Раньше
            // ответ отбрасывался, и «Никита не подключён» терялось на самом
            // частом пути: вписал имя в поле, сохранил, считаешь, что
            // поручил.
            void participants.attachOnCreate(t.id, t.assignee, pending).then((notices) => {
              for (const notice of notices || []) toasts.showToast(notice);
            });
          }}
          onDelete={() => modalTask && deleteTask(modalTask)}
          onClose={closeModal}
          onAddAssignee={actions.addAssignee}
          onAddSection={actions.saveSection}
          onRemoveSection={removeSection}
          participants={modalTask ? participants.forTask(modalTask.id) : []}
          availablePeople={participants.people}
          onPersonAdded={(name) => participants.waitForPerson(name)}
          onAddParticipant={(assigneeId, role) => (modalTask ? participants.add(modalTask.id, assigneeId, role) : undefined)}
          onSetParticipantRole={(id, role) => void participants.setRole(id, role)}
          onRemoveParticipant={(id) => void participants.remove(id)}
          onApproveWork={async (comment) => {
            if (!modalTask) return;
            try {
              await participants.approve(modalTask.id, comment);
            } catch (e) {
              // Молча проглоченная приёмка — это задача, которую все
              // считают закрытой, и она не закрыта.
              toasts.showToast(e instanceof Error ? e.message : "Не получилось принять работу");
              return;
            }
            // Задачу закрывает и сам маршрут (см. /api/workspace/review) —
            // здесь то же самое делается локально, чтобы это было видно
            // сразу, не дожидаясь эха. Обе стороны ставят «done», поэтому
            // перезаписать друг друга они не могут.
            //
            // approvalState едет рядом: приёмка живёт вне колонок синхронизации
            // (taskToRow её не пишет), так что в базу отсюда она не попадёт, а
            // на экране блок «Принимаете работу?» исчезнет сразу — раньше он
            // оставался висеть до перезагрузки, и приёмка выглядела
            // несработавшей.
            toggleDone({ ...modalTask, status: "in_progress", approvalState: "accepted", approvalComment: comment });
            // Принято — значит закрыто, и смотреть больше не на что: задача
            // в ту же секунду уезжает в «Завершённые». Окно, остающееся
            // открытым над закрытой задачей, — это вопрос «а что, не
            // сработало?», который Кирилл задавал вслух.
            closeModal();
          }}
          onReturnWork={async (comment) => {
            if (!modalTask) return;
            try {
              await participants.returnForRework(modalTask.id, comment);
            } catch (e) {
              toasts.showToast(e instanceof Error ? e.message : "Не получилось вернуть на доработку");
              return;
            }
            // Возврат — тоже решение, после которого делать в карточке
            // нечего: задача уходит обратно в свой столбец и ждёт человека,
            // а не вас.
            closeModal();
          }}
          onAcceptReschedule={async (participantId, date) => {
            if (!modalTask) return;
            // Срок — колонка синхронизации, поэтому двигается обычным
            // сохранением задачи, а не записью в базу мимо него. Сама
            // просьба закрывается маршрутом: он же и скажет человеку, чем
            // кончилось.
            actions.saveTask({ ...modalTask, deadline: date });
            try {
              await participants.decideReschedule(modalTask.id, participantId, true, date);
            } catch (e) {
              toasts.showToast(e instanceof Error ? e.message : "Не получилось ответить на просьбу");
            }
          }}
          onRejectReschedule={async (participantId) => {
            if (!modalTask) return;
            try {
              await participants.decideReschedule(modalTask.id, participantId, false);
            } catch (e) {
              toasts.showToast(e instanceof Error ? e.message : "Не получилось ответить на просьбу");
            }
          }}
          onForceCloseWork={async (reason) => {
            if (!modalTask) return;
            try {
              await participants.forceClose(modalTask.id, reason);
            } catch (e) {
              toasts.showToast(e instanceof Error ? e.message : "Не получилось закрыть задачу");
              return;
            }
            toggleDone({ ...modalTask, status: "in_progress", approvalState: "accepted", approvalComment: reason });
          }}
        />
      )}
    </div>
  );
}
