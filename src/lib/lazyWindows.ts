// Окна трекера грузятся отдельно от доски — и подгружаются заранее.
//
// До 20.10.2026 главная страница везла одним куском ВЕСЬ трекер: окно
// задачи, окно встречи, обсуждение со смайликами, «Команду», личный
// кабинет, поиск, повестку — около полутора мегабайт скриптов, которые
// телефон обязан разобрать и выполнить прежде, чем доска оживёт, хотя
// ни одно из этих окон в первую секунду не открыто. Аудит скорости
// (просьба Кирилла «улучши скорость!») начал с этого: окна живут
// отдельными кусками и не стоят на пути к первому кадру.
//
// Но окно обязано открываться сразу — правило «экран отвечает раньше
// облака». Поэтому `prefetchWindows()` просит все куски фоном, как только
// браузер освободился после первого кадра: к моменту нажатия они уже в
// памяти, а сервис-воркер держит их в кэше (cache-first для
// /_next/static). Нажатие раньше этого — редкость первых секунд, и стоит
// оно одного короткого ожидания, а не белого экрана.
//
// Загрузчики объявлены здесь ОДИН раз: `dynamic()` у места использования
// и фоновая подгрузка зовут одну и ту же функцию, иначе легко добавить
// окно в одно место и забыть в другом.

export const loadTaskModal = () => import("@/components/tracker/TaskModal");
export const loadMeetingModal = () => import("@/components/tracker/MeetingModal");
export const loadTeamModal = () => import("@/components/tracker/TeamModal");
export const loadAccountModal = () => import("@/components/tracker/AccountModal");
export const loadSearchOverlay = () => import("@/components/tracker/SearchOverlay");
export const loadSectionsModal = () => import("@/components/tracker/SectionsModal");
export const loadMeetingTasksSheet = () => import("@/components/tracker/MeetingTasksSheet");
export const loadSentIdeasModal = () => import("@/components/tracker/SentIdeasModal");
export const loadDoneListModal = () => import("@/components/tracker/DoneListModal");
export const loadLoadModal = () => import("@/components/tracker/LoadModal");
export const loadIdeaReviewModal = () => import("@/components/tracker/IdeaReviewModal");

const ALL = [
  // Первыми — то, что открывают чаще всего.
  loadTaskModal,
  loadMeetingModal,
  loadLoadModal,
  loadDoneListModal,
  loadAccountModal,
  loadTeamModal,
  loadSearchOverlay,
  loadSentIdeasModal,
  loadIdeaReviewModal,
  loadMeetingTasksSheet,
  loadSectionsModal,
];

let started = false;

export function prefetchWindows(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const go = () => {
    for (const load of ALL) void load().catch(() => {
      // Не загрузилось фоном — загрузится при нажатии. Повторять здесь
      // незачем: сеть, которая отказала сейчас, откажет и через секунду.
    });
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(go, { timeout: 2500 });
  else setTimeout(go, 1200);
}
