"use client";

// Доска задач: четыре столбца-состояния, фильтры над ними и карточка
// задачи.
//
// Столбцы «Краткосрочные» и «Долгосрочные» отсюда ушли вместе с самим
// понятием срочности — «критерий краткосрочности или долгосрочности
// вообще удали». Вместо них настоящий канбан, где столбец отвечает не на
// «как это назвали», а на «где это сейчас»: правило живёт в lib/kanban.ts,
// панель только показывает его и разбирает перетаскивание.
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Section, Task, TaskPrefill } from "@/types/tracker";
import { isOverdue, isTaskDueOnDate, taskSortFn } from "@/lib/taskDisplay";
import { KANBAN_COLUMNS, columnOf, moveBetween, type KanbanColumn } from "@/lib/kanban";
import { matchesView, myRoleOn, showsOverdue, type BoardView } from "@/lib/myRole";
import { moveWithin } from "@/lib/dndOrder";
import { useDropHandler, type DropTarget } from "./dnd/TrackerDnd";
import { SortableTask, TaskColumnBody } from "./dnd/SortableTask";
import TaskCard from "./TaskCard";
import type { ActionMenuItem } from "./ActionMenu";
import TaskModal from "./TaskModal";
import SendMenu from "./SendMenu";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useTaskParticipants } from "@/hooks/useTaskParticipants";
import { useSectionAssignees } from "@/hooks/useSectionAssignees";
import { progressShort, taskStage } from "@/lib/taskProgress";
import { peopleLoad } from "@/lib/peoplePanel";
import type { useToasts } from "@/hooks/useToasts";
import SectionTabs from "./SectionTabs";
import SectionsModal from "./SectionsModal";
import LoadModal from "./LoadModal";
import { useAsk } from "@/components/Ask";
import { uid } from "@/lib/uid";
import Icon from "./Icon";
import { isMine } from "@/lib/ownership";
import { useAuthors } from "@/hooks/useAuthors";

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
  myMemberAssigneeId = "",
  ownerId = "",
  filterAssignee,
  onFilterAssigneeChange,
  justCreatedId,
  notifBanner,
  extraBanner,
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
  onIdeaDropped: (ideaId: string) => void;
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
  // Моя строка в списке людей, если она названа членством. У владельца
  // членства нет, и его строка находится по метке «(я)» в useWorkspaceRole.
  myMemberAssigneeId?: string;
  // Чьё это пространство: строка привязки «раздел → человек» заводится в
  // нём, а не в том, откуда нажали.
  ownerId?: string;
  // Фильтр по исполнителю живёт снаружи: тот же выбор делает панель
  // «Люди», и две копии одного состояния разошлись бы в первый же день.
  filterAssignee: string;
  onFilterAssigneeChange: (name: string) => void;
  justCreatedId?: string | null;
  notifBanner?: string | null;
  // Rendered under the notification banner, in the same slot legacy's
  // #syncErrorBanner occupied (see SyncErrorBanner).
  extraBanner?: ReactNode;
}) {
  // «Просрочено» — не сортировка и не раздел, а вопрос «что горит»: он
  // задаётся чаще всех прочих фильтров вместе взятых.
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  // Чьи задачи показывает доска: то, что ждут от меня, то, что поручил я,
  // или всё сразу.
  //
  // Начинается с «Все», и это не безразличие к порядку: у руководителя
  // «все» и означает «моё и то, что я поручил» — больше ему база не
  // покажет, — а у владельца доска, открывшаяся на «Мне», спрятала бы
  // всё, что он поручил другим. Сужают взгляд по необходимости, а не по
  // умолчанию.
  const [view, setView] = useState<BoardView>("all");
  const [filterSection, setFilterSection] = useState("all");
  // Окно «Разделы»: названия, ответственные, удаление. Только у админа.
  const [sectionsOpen, setSectionsOpen] = useState(false);
  // Какой столбец доски показан на телефоне.
  const [mobileColumn, setMobileColumn] = useState<KanbanColumn>("new");
  // Окно «Загрузка»: кто чем занят и у кого горит. Раньше стояло панелью в
  // правой колонке (см. LoadModal — там же причина переезда).
  const [loadOpen, setLoadOpen] = useState(false);
  const [modalState, setModalState] = useState<{ open: boolean; task: Task | null; prefill?: TaskPrefill }>({ open: false, task: null });
  const isMobile = useIsMobile();
  // Кто на задаче — один слой на всю панель: и карточки, и форма
  // читают отсюда, чтобы не заводить по подписке на каждую карточку.
  const participants = useTaskParticipants();
  // Кто отвечает за раздел — отсюда берутся люди для задачи, заведённой
  // правой кнопкой по разделу.
  const sectionLinks = useSectionAssignees();
  // Кто из логинов какой человек: карточка чужого поручения подписывается
  // именем, а не идентификатором.
  const authors = useAuthors();
  const ask = useAsk();
  // On a phone the four filter controls cost a third of the screen before
  // a single task is visible, and most days none of them is touched — so
  // they fold away, with a dot on the button when any is actually set.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Свёрнутый столбец помнится между загрузками: доска у каждого своя, и
  // тот, кто не принимает работу, сворачивает «На приёмке» один раз.
  const [collapsedCols, setCollapsedCols] = useState<Record<string, boolean>>(() => {
    const empty: Record<string, boolean> = {};
    if (typeof localStorage === "undefined") return empty;
    try {
      const out: Record<string, boolean> = {};
      for (const c of KANBAN_COLUMNS) out[c.id] = localStorage.getItem("kkt_collapsed_" + c.id) === "1";
      return out;
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

  // Моя роль в задаче — один ответ, которым пользуются и цвет карточки, и
  // фильтр, и подсветка просрочки (см. lib/myRole).
  const roleOn = (t: Task) => myRoleOn(participants.forTask(t.id), myMemberAssigneeId);
  // Имя постановщика — только у чужого поручения. Своё подписывать своим же
  // именем значит повторять на каждой карточке то, что и так известно.
  const authorOf = (t: Task) => (mine(t) ? "" : authors[t.createdBy || ""] || "");

  // Цифра на кнопке считается по всем задачам, а не по отфильтрованным:
  // иначе, включив фильтр, она показывала бы сама себя.
  const overdueCount = tasks.filter((t) => isOverdue(t)).length;
  // Сколько горит в том, что поручил я. Отдельная цифра, потому что
  // отдельный вопрос: своё просроченное — «я не успел», чужое — «пора
  // толкнуть». Стоит на переключателе, а не краской на карточках: у
  // постановщика четырнадцати человек доска иначе краснеет целиком.
  const assignedOverdue = tasks.filter((t) => mine(t) && isOverdue(t) && roleOn(t) === "none").length;
  // Есть ли вообще чужие поручения. Пока их нет, переключатель вида — три
  // кнопки, две из которых ничего не меняют.
  const sharedBoard = tasks.some((t) => !mine(t) || roleOn(t) !== "none");

  // Загрузка людей — считается здесь, а не только в окне: от неё зависит,
  // показывать ли вообще кнопку и какую цифру на ней писать. Цифра — это
  // число тех, у кого есть о чём говорить (горит, молчит или ждёт
  // приёмки), а не число людей: «14» на кнопке не новость, «2» — новость.
  const load = useMemo(() => peopleLoad(tasks, assignees), [tasks, assignees]);
  const peopleWithWork = load.length;
  const hotPeople = load.filter((p) => p.overdue > 0 || p.silent > 0 || p.review > 0).length;

  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  const filtered = tasks.filter((t) => {
    if (filterAssignee !== "all" && t.assignee !== filterAssignee) return false;
    if (onlyOverdue && !isOverdue(t)) return false;
    if (sharedBoard && !matchesView(view, t, roleOn(t), myUserId)) return false;
    if (filterSection !== "all" && (t.sectionId || "") !== filterSection) return false;
    if (calendarFilterDate && !isTaskDueOnDate(t, new Date(calendarFilterDate + "T00:00:00"))) return false;
    return true;
  });

  const stageOf = (t: Task) => taskStage(participants.forTask(t.id), t.approvalState || "open");

  // Поставил ли человек эту задачу сам себе. Тогда столбца «Новые» для неё
  // не существует (см. lib/kanban): ждать ответа не от кого.
  //
  // Сравниваются ИМЕНА, а не идентификаторы, и это единственный доступный
  // здесь способ: автор — это логин (created_by), исполнитель — строка в
  // списке людей, и связывает их только имя. У владельца created_by пуст,
  // и его собственное имя — то, что помечено «(я)».
  const selfName = participants.people.find((x) => x.name.trim().endsWith("(я)"))?.name || "";
  const selfAssignedOn = (t: Task) => {
    const executorNames = participants.forTask(t.id).filter((x) => x.role === "executor").map((x) => x.name);
    if (executorNames.length !== 1) return false;
    const authorName = t.createdBy ? authors[t.createdBy] || "" : selfName;
    return !!authorName && authorName === executorNames[0];
  };

  // Задачи, разложенные по столбцам доски. Считается один раз на отрисовку:
  // columnOf читает строки участия, и звать его по разу на столбец значило
  // бы пройти список четырежды.
  const byColumn: Record<KanbanColumn, Task[]> = { new: [], work: [], review: [], done: [] };
  for (const t of filtered) byColumn[columnOf(t, participants.forTask(t.id), selfAssignedOn(t))].push(t);
  for (const id of Object.keys(byColumn) as KanbanColumn[]) byColumn[id].sort(taskSortFn);
  // Завершённые — свежими вперёд: этот столбец открывают, чтобы вернуть то,
  // что только что закрыли, и порядок закрытия важнее порядка сроков.
  byColumn.done.sort((a, b) => {
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

  // Правая кнопка по разделу: новая задача, в которой уже стоят те, кто за
  // этот раздел отвечает (миграция 0036). Ради этого привязку и заводили —
  // одно нажатие вместо «открыть форму, выбрать раздел, выбрать троих».
  function newTaskForSection(section: Section) {
    const people = sectionLinks
      .forSection(section.id)
      .map((row) => ({ name: participants.people.find((x) => x.id === row.assigneeId)?.name || "", role: row.role }))
      .filter((x) => x.name);
    setModalState({
      open: true,
      task: null,
      prefill: { sectionId: section.id, people },
    });
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
    // ней он может там, где это его дело, — внутри самой задачи.
    if (!mine(t)) {
      toasts.showToast("Это не ваша задача", "Откройте её — там кнопки «Принял» и «Сделал».");
      return;
    }
    if (t.status === "done") {
      actions.saveTask({ ...t, status: "in_progress", lastCompletedOn: "", completedAt: "", approvalState: "open", approvalComment: "" });
      // Приёмка — серверная колонка, и снятая галочка её не трогает: без
      // этого вызова принятая задача оставалась бы в «Завершённых» при
      // снятой галочке, то есть открыть её было нечем вовсе. Заодно об
      // этом узнают исполнители — для них задача снова живая.
      if (t.approvalState === "accepted") {
        void participants.reopen(t.id, "").catch((e) => {
          toasts.showToast(e instanceof Error ? e.message : "Не получилось вернуть задачу в работу");
        });
      }
    } else {
      // completedAt is what orders the "завершённые" list newest-first, so
      // the task just closed is the one at the top, ready to be reopened.
      actions.saveTask({ ...t, status: "done", lastCompletedOn: new Date().toISOString().slice(0, 10), completedAt: new Date().toISOString() });
    }
  }

  // Кого ещё, кроме меня, эта задача касается как исполнителя.
  const otherExecutors = (t: Task) =>
    participants.forTask(t.id).filter((p) => p.role === "executor" && p.assigneeId !== myMemberAssigneeId);

  // Быстрая галочка на карточке.
  //
  // Слова Кирилла 20.09.2026: «если задача поставлена не самому себе, а
  // другому участнику, должно требоваться заполнение „Результата“. То есть
  // если ты увидел, что поставленную тобой задачу уже выполнили и тебя
  // устраивает результат, сам её закрываешь лёгким способом».
  //
  // Разница между двумя случаями не в строгости, а в том, кто ещё об этом
  // узнает. Задача самому себе — заметка: галочка и всё. Задача, отданная
  // человеку, закрывается ЗА него: он ждёт ответа, и «закрыто» без единого
  // слова выглядит как «задачу молча отменили». Поэтому спрашивается
  // результат, и дальше это уже не правка статуса, а обычный путь трекера:
  // если по задаче отчитались — приёмка, если нет — волевое закрытие. Оба
  // идут через /api/workspace/review, то есть человеку уходит сообщение, а
  // в хронику задачи — строка.
  async function quickDone(t: Task) {
    if (!mine(t)) {
      toasts.showToast("Это не ваша задача", "Откройте её — там кнопки «Принял» и «Сделал».");
      return;
    }
    // Снятие галочки — отдельный разговор (см. toggleDone: у принятой
    // задачи это ещё и открытие заново).
    if (t.status === "done" || !otherExecutors(t).length) {
      toggleDone(t);
      return;
    }

    const onReview = stageOf(t) === "awaiting_review";
    const comment = await ask.ask({
      title: onReview ? "Принять работу" : "Закрыть задачу",
      question: onReview ? `Что принимаем по задаче «${t.title}»?` : `Что сделано по задаче «${t.title}»?`,
      note: onReview
        ? "Исполнители отчитались — ваши слова придут им вместе с закрытием."
        : "Задачу делает другой человек, и она закроется без его отчёта. Напишите результат — он это увидит.",
      placeholder: "Например: прайс согласован, отправили клиенту",
      okText: onReview ? "Принять" : "Закрыть",
      required: "Без результата закрывать нельзя.",
    });
    if (!comment?.trim()) return;

    try {
      if (onReview) await participants.approve(t.id, comment.trim());
      else await participants.forceClose(t.id, comment.trim());
    } catch (e) {
      toasts.showToast(e instanceof Error ? e.message : "Не получилось закрыть задачу");
      return;
    }
    // Маршрут ставит done сам; здесь то же самое ставится локально, чтобы
    // карточка уехала в «Завершённые» сразу, не дожидаясь эха. Обе стороны
    // говорят одно и то же, поэтому перезаписать друг друга не могут (см.
    // правило про приёмку в CLAUDE.md).
    toggleDone({ ...t, approvalState: "accepted", approvalComment: comment.trim() });
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

  // Куда положили: столбец и сосед, перед которым вставать.
  function columnTargetOf(target: DropTarget): { column: KanbanColumn; beforeId: string | null } | null {
    if (target.kind === "task-column") return { column: target.column, beforeId: null };
    if (target.kind === "task") return { column: target.column, beforeId: target.id };
    return null;
  }

  // Перетаскивание на доске — это ДЕЙСТВИЕ, а не перекладывание ярлыка.
  //
  // В этом вся разница между доской, которая показывает работу, и доской,
  // на которой её изображают. Перенести карточку в «В работе» значит
  // принять задачу; в «На приёмке» — отчитаться; в «Завершённые» — принять
  // работу. У каждого действия есть тот, кому оно позволено (см.
  // lib/kanban.moveBetween), и отказ говорится словами, а не молчанием.
  //
  // И только вперёд: назад доска не ходит вовсе (там же, в moveBetween,
  // написано почему). Возврат на доработку и открытие закрытой задачи
  // остались кнопкой и галочкой в самой карточке — там, где спрашивают
  // причину.
  //
  // Отчёт и приёмка требуют комментария — правило трекера, а не прихоть
  // формы, — поэтому вместо мгновенной записи они открывают карточку на
  // нужном месте. Перетаскивание тут доводит до двери, а не проходит за
  // человека.
  async function handleTaskDrop(taskId: string, target: DropTarget) {
    const spot = columnTargetOf(target);
    // Не наш случай: задачу могли бросить на день календаря — это разбирает
    // календарь, у него свой обработчик.
    if (!spot) return;
    const dragged = tasks.find((t) => t.id === taskId);
    if (!dragged) return;

    const from = columnOf(dragged, participants.forTask(dragged.id), selfAssignedOn(dragged));
    const to = spot.column;

    // Внутри столбца — обычная перестановка: порядок принадлежит задаче, и
    // менять его вправе тот, кто её поставил.
    if (from === to) {
      if (!mine(dragged)) {
        toasts.showToast("Это не ваша задача", "Порядок в столбце меняет тот, кто её поставил.");
        return;
      }
      const ids = byColumn[to].map((t) => t.id);
      moveWithin(ids, taskId, spot.beforeId).forEach((id, i) => {
        const t = tasks.find((x) => x.id === id);
        if (!t || t.manualOrder === i) return;
        actions.saveTask({ ...t, manualOrder: i });
      });
      return;
    }

    const myRole = roleOn(dragged);
    const move = moveBetween(from, to, { isAuthor: mine(dragged), isExecutor: myRole === "executor" });
    if (!move) return;
    if ("refused" in move) {
      toasts.showToast("Так нельзя", move.refused);
      return;
    }

    const myRow = participants.forTask(dragged.id).find((p) => p.assigneeId === myMemberAssigneeId);

    if (move.action === "accept") {
      if (!myRow) return;
      try {
        await participants.acceptWork(myRow.id);
        toasts.showToast("Взяли в работу", dragged.title);
      } catch (e) {
        toasts.showToast("Не получилось", e instanceof Error ? e.message : "");
      }
      return;
    }

    // «Сделал» и «Принять работу» требуют комментария, и спрашивает его
    // карточка. Открываем её: человек уже сказал, что хочет сделать,
    // осталось сказать словами.
    setModalState({ open: true, task: dragged });
    toasts.showToast(
      move.action === "report" ? "Отчёт — словами" : "Приёмка — словами",
      move.action === "report" ? "Напишите, что сделано, в открывшейся карточке." : "Подтвердите приёмку в открывшейся карточке.",
    );
  }

  // Мысль, брошенная в столбец задач, становится задачей — это разбирает
  // владелец мыслей, а сюда приходит уже готовым обработчиком.
  function handleIdeaDrop(ideaId: string, target: DropTarget) {
    if (!columnTargetOf(target)) return;
    onIdeaDropped(ideaId);
  }

  useDropHandler("task", (id, target) => void handleTaskDrop(id, target));
  useDropHandler("idea", handleIdeaDrop);

  // Ручной порядок — та же перестановка, что мышью, но кнопкой: на телефоне
  // перетаскивание есть, а точности в нём нет.
  function moveWithinColumn(t: Task, to: "top" | "bottom") {
    const column = columnOf(t, participants.forTask(t.id), selfAssignedOn(t));
    const others = byColumn[column].filter((x) => x.id !== t.id).map((x) => x.id);
    const ids = to === "top" ? [t.id, ...others] : [...others, t.id];
    ids.forEach((id, i) => {
      const task = tasks.find((x) => x.id === id);
      if (!task || task.manualOrder === i) return;
      actions.saveTask({ ...task, manualOrder: i });
    });
  }

  function menuItemsFor(t: Task): ActionMenuItem[] {
    // Порядок — свойство самой задачи, то есть правка. У чужой задачи
    // остаётся только то, что правкой не является: показать её коллеге и
    // собрать по ней встречу.
    //
    // Пункта «в другой столбец» здесь больше нет, и это не пропуск. Столбец
    // доски — состояние задачи, а не ярлык: перенести её в «В работе»
    // значит принять, в «На приёмке» — отчитаться. Такие вещи делаются
    // кнопками в самой карточке, где спрашивают комментарий и где видно,
    // кому что позволено, а не пунктом меню, который сделал бы это молча.
    const items: ActionMenuItem[] = mine(t)
      ? [
          { id: "top", label: "Наверх списка", icon: "arrow-up", onSelect: () => moveWithinColumn(t, "top") },
          { id: "bottom", label: "В конец списка", icon: "arrow-down", onSelect: () => moveWithinColumn(t, "bottom") },
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
    items.push({ id: "send", label: "Отправить участнику", icon: "send", onSelect: () => setSendTask(t) });
    return items;
  }

  // «Завершённые» появляются в полосе только вместе с кнопкой, которая их
  // открывает, — и если выбранный столбец исчез, показываем «Новые», а не
  // пустоту от несуществующего столбца.
  const visibleColumns: KanbanColumn[] = showDone ? ["new", "work", "review", "done"] : ["new", "work", "review"];
  const shownColumn: KanbanColumn = visibleColumns.includes(mobileColumn) ? mobileColumn : "new";

  function renderColumn(column: KanbanColumn) {
    const meta = KANBAN_COLUMNS.find((c) => c.id === column)!;
    const list = byColumn[column];
    const collapsed = collapsedCols[column];
    return (
      <div className={"column col-" + column + (collapsed ? " collapsed" : "")} id={"col-" + column} key={column}>
        <div className="section-title" onClick={() => toggleCollapsed(column)}>
          {meta.title} <span className="count">{list.length}</span>
          <span className="collapse-arrow">▾</span>
        </div>
        <TaskColumnBody column={column} ids={list.map((t) => t.id)} empty={list.length === 0}>
          {list.length === 0 ? (
            <div className="empty">{meta.empty}</div>
          ) : (
            list.map((t) => {
              const role = roleOn(t);
              return (
                <SortableTask key={t.id} task={t} column={column} draggable={mine(t) || role === "executor"}>
                  {(dragProps, isDragging) => (
                    <TaskCard
                      task={t}
                      section={sectionById.get(t.sectionId) ?? null}
                      progress={progressShort(participants.forTask(t.id))}
                      stage={stageOf(t)}
                      role={role}
                      outgoing={mine(t) && role === "none" && sharedBoard}
                      dimOverdue={!showsOverdue(role, !sharedBoard || view === "assigned")}
                      onToggleDone={() => void quickDone(t)}
                      // Галочка — право постановщика: закрыть задачу
                      // значит сказать «принято», а это его слово.
                      // Исполнитель отвечает кнопками в самой карточке
                      // («Принял», «Сделал»), и показывать ему галочку,
                      // после которой придёт отказ, незачем.
                      canComplete={mine(t)}
                      onOpen={() => setModalState({ open: true, task: t })}
                      isDragging={isDragging}
                      dragProps={dragProps}
                      justCreated={justCreatedId === t.id}
                      menuItems={isMobile ? menuItemsFor(t) : undefined}
                      authorName={authorOf(t)}
                    />
                  )}
                </SortableTask>
              );
            })
          )}
        </TaskColumnBody>
      </div>
    );
  }

  return (
    <div className="main-col dash-panel" id="mainCol" data-panel-id="mainCol">
      {notifBanner && (
        <div className="notif-banner show" id="notifBanner">
          {notifBanner}
        </div>
      )}
      {extraBanner}
      {(() => {
        const filtersActive = filterSection !== "all" || filterAssignee !== "all" || onlyOverdue || view !== "all";
        const collapsed = isMobile && !filtersOpen;
        return (
          // Строки с надписью «ЗАДАЧИ» над этой панелью больше нет: она
          // ничего не объясняла (задачи ни с чем не спутать) и стоила
          // высоты.
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
                {/* Текст не меняется вместе с состоянием: «Скрыть фильтры»
                    шире «Фильтров», и кнопка при нажатии толкала соседнюю.
                    Что фильтры раскрыты, видно по ним самим. */}
                Фильтры
                {filtersActive && <span className="toolbar-filter-dot" />}
              </button>
            )}
            <div className="search-wrap" id="quickAddSlot" />
            {/* «Загрузка» вместо фильтра по исполнителю.

                Слова Кирилла 20.09.2026: «фильтр по исполнителю получается
                не нужен, если добавил блок загрузка». Он прав — это был
                один и тот же вопрос, заданный дважды: список из
                четырнадцати имён без единой цифры рядом и список тех же
                людей с цифрами. Осталось второе, и оно же фильтрует.

                Кнопки нет вовсе, пока поручать некому: пустое окно со
                словами «никому ничего не поручено» — это кнопка, после
                которой ничего не произошло. */}
            {peopleWithWork > 0 && (
              <span className={"load-pill" + (filterAssignee !== "all" ? " active" : "")}>
                <button
                  type="button"
                  className="load-pill-main"
                  id="loadBtn"
                  title={filterAssignee === "all" ? "Кто чем занят" : `Показана только загрузка: ${filterAssignee}`}
                  onClick={() => setLoadOpen(true)}
                >
                  <Icon name="users" size={14} /> {filterAssignee === "all" ? "Загрузка" : filterAssignee}
                  {filterAssignee === "all" && hotPeople > 0 && <span className="filter-pill-count">{hotPeople}</span>}
                </button>
                {/* Снять фильтр — там же, где он виден. Иначе единственный
                    путь обратно ко всей доске лежал бы через окно, а
                    человек, забывший о фильтре, видел бы доску, на которой
                    «пропали задачи». */}
                {filterAssignee !== "all" && (
                  <button type="button" className="load-pill-x" title="Показать задачи всех" onClick={() => onFilterAssigneeChange("all")}>
                    <Icon name="close" size={12} />
                  </button>
                )}
              </span>
            )}
            {/* Все / Мне / Я поручил.

                Это ответ на вопрос Кирилла о том, как выделять задачи, где
                он постановщик, «среди всего аврала задач, при условии что
                там будут 14 человек работать». Не цветом: цвет на карточке
                уже занят ролью и сроком, а третий смысл превратил бы доску
                в светофор. «Я поручил» — это не свойство задачи, а режим
                взгляда на неё, и место такому — переключатель, а не краска.

                Порядок кнопок продиктован им же 20.09.2026 («ВСЕ МНЕ Я
                ПОРУЧИЛ, именно в таком порядке»), и он логичен: первым
                стоит то, что включено по умолчанию, а сужения — за ним.

                Появляется только там, где работают вместе: пока поручает и
                выполняет один человек, все три кнопки показывают одно и то
                же. */}
            {sharedBoard && (
              <div className="view-switch" role="group" aria-label="Чьи задачи показывать">
                {(
                  [
                    ["all", "Все"],
                    ["mine", "Мне"],
                    ["assigned", "Я поручил"],
                  ] as [BoardView, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={"view-switch-btn" + (view === id ? " active" : "")}
                    aria-pressed={view === id}
                    onClick={() => setView(id)}
                  >
                    {label}
                    {id === "assigned" && assignedOverdue > 0 && <span className="filter-pill-count">{assignedOverdue}</span>}
                  </button>
                ))}
              </div>
            )}
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
            <button
              type="button"
              className={"filter-pill done" + (showDone ? " active" : "")}
              id="showDoneCheckbox"
              aria-pressed={showDone}
              onClick={() => {
                const next = !showDone;
                onShowDoneChange(next);
                // На телефоне столбец один, и открыть четвёртый, не перейдя
                // на него, — это кнопка, после которой ничего не произошло.
                if (isMobile) setMobileColumn(next ? "done" : "new");
              }}
            >
              {/* Счётчика здесь нет намеренно. Он появлялся ровно в момент
                  нажатия — то есть кнопка становилась шире, а вся полоса
                  справа от неё уезжала под курсором. Слова Кирилла
                  20.09.2026: «не хочу, чтобы в трекере нажатие одной кнопки
                  двигало другие кнопки или разделы». Сколько завершённых, и
                  так написано в заголовке открывшегося столбца. */}
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
        onNewTask={(section) => newTaskForSection(section)}
        onSettings={() => setSectionsOpen(true)}
        onReorder={(ids) =>
          ids.forEach((id, i) => {
            const s = sections.find((x) => x.id === id);
            if (s && s.sortOrder !== i) actions.saveSection({ ...s, sortOrder: i });
          })
        }
      />

      {/* Доска. Три столбца стоят всегда — это путь задачи, и прятать в
          нём звено значит прятать шаг работы. Четвёртый, «Завершённые»,
          открывается кнопкой: слова Кирилла — «тут я теперь хочу, чтобы
          кнопка завершённые открывала только колонку кан-бана
          „завершённые“».

          На телефоне столбцы не встают друг под друга: четыре списка в
          одну ленту означают, что до «На приёмке» надо пролистать всё
          остальное. Там доска показывает один столбец, выбранный полосой
          кнопок, — и цифры на кнопках заодно отвечают на «сколько где»,
          не открывая ничего. */}
      {isMobile ? (
        <>
          <div className="board-tabs" role="group" aria-label="Столбец доски">
            {visibleColumns.map((id) => {
              const meta = KANBAN_COLUMNS.find((c) => c.id === id)!;
              return (
                <button
                  key={id}
                  type="button"
                  className={"board-tab" + (mobileColumn === id ? " active" : "")}
                  aria-pressed={mobileColumn === id}
                  onClick={() => setMobileColumn(id)}
                >
                  {meta.title}
                  <span className="board-tab-count">{byColumn[id].length}</span>
                </button>
              );
            })}
          </div>
          <div className="columns columns-single">{renderColumn(shownColumn)}</div>
        </>
      ) : (
        <div className={"columns" + (showDone ? " with-done" : "")}>
          {renderColumn("new")}
          {renderColumn("work")}
          {renderColumn("review")}
          {showDone && renderColumn("done")}
        </div>
      )}

      {sectionsOpen && isAdmin && (
        <SectionsModal
          sections={sections}
          people={participants.people}
          ownerId={ownerId}
          onClose={() => setSectionsOpen(false)}
          onSave={actions.saveSection}
          onDelete={(section) => void deleteSectionAsked(section)}
        />
      )}

      {loadOpen && (
        <LoadModal
          tasks={tasks}
          assignees={assignees}
          selected={filterAssignee}
          onSelect={onFilterAssigneeChange}
          onClose={() => setLoadOpen(false)}
        />
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
          // Справочники (люди, разделы) заводит администратор — см.
          // TaskModal.isAdmin.
          isAdmin={isAdmin}
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
          myAssigneeId={myMemberAssigneeId}
          onAcceptWork={participants.acceptWork}
          onReportWork={participants.reportWork}
          onDeclineWork={participants.declineWork}
          onAskReschedule={participants.askReschedule}
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
          onReopenWork={async (comment) => {
            if (!modalTask) return;
            try {
              await participants.reopen(modalTask.id, comment);
            } catch (e) {
              toasts.showToast(e instanceof Error ? e.message : "Не получилось вернуть задачу в работу");
              return;
            }
            // Маршрут снимает и приёмку, и статус одной записью — здесь то
            // же самое локально, чтобы карточка уехала из «Завершённых»
            // сразу, а не после эха. Обе стороны пишут одно и то же,
            // поэтому перезаписать друг друга не могут (см. приёмку выше).
            actions.saveTask({
              ...modalTask,
              status: "in_progress",
              lastCompletedOn: "",
              completedAt: "",
              approvalState: "open",
              approvalComment: "",
            });
            closeModal();
          }}
        />
      )}
    </div>
  );
}
