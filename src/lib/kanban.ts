import type { Task } from "@/types/tracker";
import type { TaskParticipant } from "@/lib/taskProgress";
import { hasDeclined, taskProgress } from "@/lib/taskProgress";

// Столбец доски — это состояние задачи, а не её ярлык.
//
// Раньше столбцов было три: «Краткосрочные», «Долгосрочные» и «На приёмку».
// Первые два делили задачи по полю `term`, которое человек выставлял
// руками, — то есть доска показывала не то, что с задачами происходит, а
// то, как их однажды рассортировали. Кирилл убрал это сам 19.09.2026:
// «долгосрочные и краткосрочные задачи соединить просто в „Задачи“,
// критерий краткосрочности или долгосрочности вообще удали».
//
// Взамен — настоящий канбан, в котором столбец отвечает на вопрос «где
// она сейчас»:
//
//   new     — отправлена, никто ещё не взялся;
//   work    — кто-то принял, отказался или её вернули на доработку;
//   review  — отчитались все исполнители, ждёт решения постановщика;
//   done    — закрыта (столбец открывается кнопкой «Завершённые»).
//
// Ничего из этого не хранится отдельной колонкой в базе, и это важно:
// вторая правда об одном факте здесь уже была дважды и оба раза разошлась
// с первой (см. правило про две правды в CLAUDE.md). Состояние выводится
// из строк участия и приёмки — из тех же данных, что и всё остальное про
// ход работы.

export type KanbanColumn = "new" | "work" | "review" | "done";

export const KANBAN_COLUMNS: { id: KanbanColumn; title: string; empty: string }[] = [
  { id: "new", title: "Новые задачи", empty: "Всё разобрано — новых нет." },
  { id: "work", title: "В работе", empty: "Пока никто ничего не взял." },
  { id: "review", title: "На приёмке", empty: "Здесь появятся задачи, по которым отчитались, — их ждёт ваше решение." },
  { id: "done", title: "Завершённые", empty: "Завершённых задач нет." },
];

export function columnOf(task: Task, participants: TaskParticipant[], selfAssigned = false): KanbanColumn {
  if (task.status === "done" || task.approvalState === "accepted") return "done";
  // Приёмка — слово постановщика, и оно старше того, что нажали исполнители.
  if (task.approvalState === "awaiting_review") return "review";
  // Возврат на доработку — это снова работа, а не «новая задача»: человек
  // уже брался за неё и знает, о чём речь.
  if (task.approvalState === "returned") return "work";

  const progress = taskProgress(participants);
  if (progress.total > 0 && progress.allDone) return "review";
  // Взялся, отказался или уже отчитался кто-то один из нескольких — всё это
  // движение, и место ему в «В работе». «Новые» означает буквально «ещё
  // никто не ответил ни слова».
  const moved = participants.some((p) => p.role === "executor" && (p.acceptedAt || p.doneAt || hasDeclined(p)));
  if (moved) return "work";
  // Задача, которую человек поставил сам себе, «новой» не бывает: «Новые»
  // означает «отправлена и ждём, что ответит человек», а отвечать тут
  // некому — он уже ответил тем, что её завёл. Без этого доска у того, кто
  // работает в одиночку, состояла бы из одного столбца «Новые», в котором
  // задачи лежат месяцами, и «Принял» приходилось бы нажимать самому себе.
  return selfAssigned ? "work" : "new";
}

// Можно ли перетащить задачу из столбца в столбец — и что это значит.
//
// Перетаскивание на доске не переставляет ярлык, а совершает действие, и
// потому у него есть права. Принять задачу может только исполнитель:
// сделать это за него — значит отчитаться за другого. Принять работу и
// вернуть её может только постановщик.
//
// Возвращается либо действие, либо причина отказа — человеческими словами,
// потому что показать её придётся ему.
export type KanbanMove =
  | { action: "accept" }
  | { action: "report" }
  | { action: "approve" }
  | { action: "return" }
  | { action: "reopen" }
  | { refused: string };

export function moveBetween(
  from: KanbanColumn,
  to: KanbanColumn,
  who: { isAuthor: boolean; isExecutor: boolean },
): KanbanMove | null {
  if (from === to) return null;

  if (to === "work" && from === "new") {
    return who.isExecutor ? { action: "accept" } : { refused: "Взять задачу в работу может только её исполнитель." };
  }
  if (to === "review") {
    if (from === "done") return { refused: "Закрытая задача возвращается в работу, а не на приёмку." };
    return who.isExecutor ? { action: "report" } : { refused: "Отчитаться по задаче может только её исполнитель." };
  }
  if (to === "done") {
    if (!who.isAuthor) return { refused: "Принять работу может только тот, кто поставил задачу." };
    return from === "review" ? { action: "approve" } : { refused: "Сначала по задаче должны отчитаться — примите её из столбца «На приёмке»." };
  }
  if (to === "work" && from === "review") {
    return who.isAuthor ? { action: "return" } : { refused: "Вернуть работу на доработку может только тот, кто поставил задачу." };
  }
  if (to === "work" && from === "done") {
    return who.isAuthor ? { action: "reopen" } : { refused: "Вернуть закрытую задачу в работу может только тот, кто её поставил." };
  }
  if (to === "new") {
    return { refused: "В «Новые» задача не возвращается: её уже видели. Вернуть можно только в работу." };
  }
  return null;
}
