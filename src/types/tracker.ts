// Domain types for the tracker's data layer. These mirror the shapes
// legacy-tracker.js has used in Supabase since Stage 1 — kept 1:1 with it
// (taskFromRow/meetingFromRow/ideaFromRow/sectionFromRow) rather than
// redesigned, so the new UI reads/writes the exact same rows the legacy UI,
// the Telegram bot, and the cron jobs already agree on.

export type Priority = "high" | "med";
export type Term = "short" | "long";
export type TaskStatus = "in_progress" | "done";
export type RecurKind = "none" | "daily" | "weekly" | "monthly" | "yearly";
// «Предложена» — то же место в жизни встречи, что «запланирована», просто
// раньше него: она существует, её видно, по ней можно ответить, но время
// она ещё не занимает. Календарь и напоминания спрашивают "planned" и
// предложенную не видят — в этом и смысл (миграция 0034).
export type MeetingStatus = "proposed" | "planned" | "success" | "no_result";
export type SectionKind = "work" | "personal";
export type ApprovalState = "open" | "awaiting_review" | "accepted" | "returned";

export interface Task {
  id: string;
  title: string;
  desc: string;
  assignee: string;
  sectionId: string;
  priority: Priority;
  // Колонка из тех времён, когда доска делилась на «краткосрочные» и
  // «долгосрочные». Критерий убран 19.09.2026 («критерий краткосрочности
  // или долгосрочности вообще удали»), столбец задачи теперь выводится из
  // её состояния (lib/kanban). Поле оставлено, потому что колонка в базе
  // объявлена not null: убирать её значило бы миграцией трогать каждую
  // строку ради того, что уже никто не читает.
  term: Term;
  status: TaskStatus;
  deadline: string; // YYYY-MM-DD or ""
  recur: RecurKind;
  recurWeekday: string; // "0"-"6"
  // Дни недели, когда повтор не один: «по понедельникам и четвергам», «по
  // будням». Пусто — читается recurWeekday (миграция 0032), потому что у
  // задач, заведённых раньше, массива нет и не будет.
  // Необязательное: у задач, заведённых до миграции 0032, его нет вовсе,
  // и правило «сначала массив, если пуст — одиночный день» это учитывает.
  recurWeekdays?: string[];
  recurMonthday: string;
  recurYearDay: string;
  recurYearMonth: string; // "1"-"12"
  lastCompletedOn: string; // YYYY-MM-DD or ""
  manualOrder: number | null;
  // ISO timestamp of when the task was last marked done ("" while open).
  // Drives the "most recently closed first" order of the завершённые list.
  completedAt: string;
  // Set when the colleague this is addressed to pressed «Принял» in
  // Telegram. Read-only here: the tracker shows it and never writes it,
  // so an open tab can never overwrite what someone just confirmed.
  acceptedAt?: string;
  // Приёмка: отчитались все исполнители — дальше слово за постановщиком.
  // Read-only in exactly the same sense as acceptedAt: written by the
  // approval buttons through their own update, never by the sync (see
  // taskToRow, which lists the columns it owns and this is not one).
  approvalState?: ApprovalState;
  approvalComment?: string;
  // Кто поставил задачу. Пусто — владелец пространства (так у всего, что
  // заведено до того, как трекер стал многопользовательским). Только для
  // чтения: синхронизация эту колонку не пишет, а интерфейс по ней решает,
  // чью задачу руководителю можно править, а чью только читать.
  createdBy?: string;
}

export interface Meeting {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM or ""
  // Сколько минут занимает: 30 или 60 (миграция 0038). Из этого
  // считается занятость людей — «в 12:00 Есина не свободна», — и
  // момент, когда бот скажет, что время кончилось.
  // Необязательное: у строк, заведённых до миграции 0038, его нет, и
  // читающий код всё равно прогоняет значение через normalizeDuration —
  // требовать его от каждого, кто собирает встречу, значит требовать
  // помнить про полчаса там, где о них не думают.
  durationMin?: number;
  title: string;
  participants: string[];
  status: MeetingStatus;
  result: string;
  movedToDate: string;
  // ISO timestamp of when the meeting was closed (success/no_result), ""
  // while it is still planned.
  resolvedAt: string;
  // Participants who pressed «Буду» in Telegram. Read-only here, same
  // reasoning as Task.acceptedAt.
  confirmedBy?: string[];
  // Какой это круг голосования. Растёт при переносе: ответы, данные о
  // прежнем времени, перестают считаться подтверждением (см. meetingVotes).
  voteRound?: number;
  // Задача, ради которой собрались. Итог такой встречи дописывается в её
  // обсуждение, а карточка задачи показывает, что по ней собирались
  // (миграция 0037). Ставится один раз, при создании.
  fromTaskId?: string;
  // Кто собрал встречу. Только для чтения, как и у задачи.
  createdBy?: string;
}

export interface Idea {
  id: string;
  text: string;
  important: boolean;
  done: boolean;
  createdAt: string; // formatted "dd.mm.yyyy hh:mm", display-only
  // ISO timestamp of when the idea was ticked off ("" while active).
  doneAt: string;
  // Кто записал мысль. Только для чтения.
  createdBy?: string;
}

export interface Section {
  id: string;
  name: string;
  kind: SectionKind;
  sortOrder: number;
}

export type Assignee = string;

// Partial pre-fill for opening a "new task"/"new meeting" modal already
// populated — used by both the calendar's date-popover (deadline/date only)
// and QuickAdd's desktop flow (full parsed fields) under the new UI.
export interface TaskPrefill {
  title?: string;
  desc?: string;
  assignee?: string;
  // Остальные исполнители, если фраза назвала нескольких: одна задача на
  // двоих — это одна задача (см. executors в quickAdd.ts).
  executors?: string[];
  priority?: Priority;
  deadline?: string;
  // Раздел и его люди — то, что подставляет правая кнопка по разделу
  // (миграция 0036). Роль здесь та же, что у участника задачи: человек
  // встанет исполнителем, соисполнителем или наблюдателем ровно так, как
  // записано в привязке.
  sectionId?: string;
  people?: { name: string; role: "executor" | "coexecutor" | "watcher" }[];
}

export interface MeetingPrefill {
  title?: string;
  date?: string;
  time?: string;
  participants?: string[];
  // Из какой задачи выросла эта встреча. Задачу нельзя «превратить» во
  // встречу — она никуда не девается; но по задаче собираются, и через
  // месяц полезно помнить, когда именно (C5). Связь записывается строкой
  // в обсуждение обоих — без новой колонки и сразу человеку видимая.
  fromTaskId?: string;
  fromTaskTitle?: string;
}

export interface PanelLayout {
  left: string[];
  center: string[];
  right: string[];
}
