// A task with several executors: what state it is actually in.
//
// One assignee and a `status` column could answer "done?" with a boolean.
// Four people cannot: three may have reported and the fourth gone quiet, one
// may have refused outright, and the whole thing may be waiting on the
// person who set it to accept the result. That is five different situations
// a card has to show differently, and every one of them is derived here from
// the participant rows — nothing about progress is stored twice.
//
// Only executors hold a task open. Co-executors help and watchers watch;
// neither is ever the reason something is still in work. Deciding that here,
// once, is what keeps the rule from drifting between the card, the bot and
// the morning briefing.

export type TaskParticipantRole = "executor" | "coexecutor" | "watcher";

export type TaskParticipant = {
  assigneeId: string;
  name: string;
  role: TaskParticipantRole;
  acceptedAt: string | null;
  doneAt: string | null;
  doneComment: string | null;
  // Документы, приложенные к отчёту (миграция 0039). В подсчётах не
  // участвуют — это про содержание ответа, а не про его наличие, — и
  // потому необязательны, как и `reachable` ниже.
  doneFiles?: { path: string; name: string; size: number; type: string }[];
  declinedAt: string | null;
  declineReason: string | null;
  // Есть ли куда прислать ему задачу. Не участвует ни в одном подсчёте —
  // это про доставку, а не про ход работы, — и потому необязательно.
  reachable?: boolean;
};

// Where the task stands, in the order it normally travels:
//   sent            — nobody has picked it up yet
//   accepted        — at least one executor took it, not everyone has finished
//   blocked         — an executor said he cannot, and has not since reported
//   awaiting_review — everyone reported; it is now on the person who set it
//   returned        — sent back for rework
//   done            — accepted by the person who set it, or force-closed
export type TaskStage = "sent" | "accepted" | "blocked" | "awaiting_review" | "returned" | "done";

// «Готово?» здесь спрашивают у двух разных колонок, и их легко перепутать —
// один раз уже перепутали, и обе оказались записаны в одну строку.
//
//   tasks.status          — личная галочка владельца. Она была здесь, когда
//                           трекер был на одного, и осталась ровно тем же:
//                           «я считаю это сделанным». Ею владеет движок
//                           синхронизации (см. taskToRow).
//   tasks.approval_state  — приёмка работы, которую делали другие. Пишется
//                           только сервером, в taskToRow её нет и быть не
//                           должно: открытая вкладка откатит.
//
// Всё остальное про ход задачи не хранится вовсе, а выводится здесь из строк
// участников — taskStage() ниже и есть единственный ответ на «а что с ней
// сейчас». Записать то же самое ещё и в колонку значит завести вторую
// правду, которая разойдётся с первой; в этом проекте так уже было с именем
// исполнителя (миграция 0024).
export type ApprovalState = "open" | "awaiting_review" | "accepted" | "returned";

export function executors(participants: TaskParticipant[]): TaskParticipant[] {
  return participants.filter((p) => p.role === "executor");
}

// A refusal that was later withdrawn by actually doing the work is not a
// refusal any more — the report is the newer fact, so `done` wins.
export function hasDeclined(p: TaskParticipant): boolean {
  return !!p.declinedAt && !p.doneAt;
}

export type TaskProgress = {
  total: number;
  doneCount: number;
  acceptedCount: number;
  doneNames: string[];
  pendingNames: string[];
  declined: { name: string; reason: string }[];
  // True only when there is somebody to wait for and nobody is left.
  allDone: boolean;
  // Каждый исполнитель ОТВЕТИЛ — отчётом или отказом.
  //
  // Отказ — это ответ, и в этом весь смысл отдельной величины. Слова
  // Кирилла 21.09.2026: «после отказа задача не переносится „на приёмку“».
  // Он прав, и причина не в месте на доске: пока задача считалась «в
  // работе», отказ никого ни к чему не обязывал — исполнитель уже
  // ответил и ждёт решения, а задача лежала в столбце, который значит
  // «идёт». Ждать в ней было некого.
  //
  // Поэтому «ответили все» шире, чем «сделали все»: доска и приёмка
  // спрашивают именно её, а allDone остался для тех мест, где важно
  // ровно «работа сдана» (например, текст сообщения постановщику).
  allAnswered: boolean;
};

export function taskProgress(participants: TaskParticipant[]): TaskProgress {
  const list = executors(participants);
  const done = list.filter((p) => !!p.doneAt);
  const declined = list.filter(hasDeclined);
  const pending = list.filter((p) => !p.doneAt && !hasDeclined(p));
  return {
    total: list.length,
    doneCount: done.length,
    acceptedCount: list.filter((p) => !!p.acceptedAt && !p.doneAt).length,
    doneNames: done.map((p) => p.name),
    pendingNames: pending.map((p) => p.name),
    declined: declined.map((p) => ({ name: p.name, reason: p.declineReason || "" })),
    allDone: list.length > 0 && done.length === list.length,
    allAnswered: list.length > 0 && pending.length === 0,
  };
}

export function taskStage(participants: TaskParticipant[], approval: ApprovalState): TaskStage {
  // Acceptance is the owner's word and outranks everything the executors
  // have or have not pressed — including a task closed over their heads.
  if (approval === "accepted") return "done";
  if (approval === "returned") return "returned";
  // 23.09.2026: a task got stuck with no button that could close it. The
  // server had already written approval_state = "awaiting_review" (every
  // executor had reported), but the participant rows the card was reading
  // locally had gone empty — a sync race, not a real state — and this
  // function used to re-derive the stage from THOSE rows instead of trusting
  // the column the server already committed. taskProgress([]) says
  // allAnswered: false, so the stage fell back to "sent" and every review
  // action (including the force-close escape hatch, gated on
  // `progress.total > 0`) disappeared at once. Two truths about one fact —
  // exactly the pattern this file's own header warns against — and here the
  // derived one won when it should have deferred to the column.
  if (approval === "awaiting_review") return "awaiting_review";

  const progress = taskProgress(participants);
  // Ответили все — дальше слово за постановщиком, даже если кто-то из
  // ответов «не могу». Принять тут нечего, а решить есть что: вернуть с
  // объяснением, перенести срок или закрыть волевым решением. Пока это
  // читалось как «blocked», задача стояла в «В работе» и не просила
  // ничего ни у кого (см. allAnswered).
  if (progress.allAnswered) return "awaiting_review";
  // Кто-то не может, а кто-то ещё молчит: ждём остальных, но задача уже
  // стоит, и это разные вещи.
  if (progress.declined.length) return "blocked";
  // acceptedCount нарочно не считает тех, кто уже отчитался (см. его
  // определение в taskProgress) — а значит на задаче с несколькими
  // исполнителями, где один уже сдал работу, а второй ещё даже не нажал
  // «Принял», acceptedCount мог остаться нулевым, и бейдж откатывался к
  // «отправлено, ещё не приняли» — при том что «1 из 2» тут же на экране
  // говорит обратное. Кирилл поймал это 24.09.2026 на задаче «2» (два
  // исполнителя, один сделал, второй молчит). columnOf в lib/kanban.ts
  // этой ошибки не знал — он и до правки считал такую задачу «в работе»
  // (moved смотрит и doneAt), — расходились только бейдж и столбец.
  if (progress.acceptedCount > 0 || progress.doneCount > 0) return "accepted";
  return "sent";
}

// Подпись стадии — одним местом на оба её показа: раньше жила только в
// TaskParticipants.tsx, а с 22.09.2026 та же самая стадия нужна и в
// сводке задачи (ItemFacts), куда переехал бейдж «в работе».
export const STAGE_LABEL: Record<TaskStage, string> = {
  sent: "отправлено, ещё не приняли",
  accepted: "в работе",
  blocked: "кто-то не может",
  awaiting_review: "на приёмке",
  returned: "на доработке",
  done: "принято",
};

// "2 из 4" is the line that makes the card readable at a glance; the names
// are what make it actionable — the point is to see WHO is missing without
// opening anything.
export function progressLabel(participants: TaskParticipant[]): string {
  const p = taskProgress(participants);
  if (!p.total) return "";
  const parts = [`${p.doneCount} из ${p.total}`];
  if (p.doneNames.length) parts.push("сделали: " + p.doneNames.join(", "));
  if (p.pendingNames.length) parts.push("ждём: " + p.pendingNames.join(", "));
  if (p.declined.length) parts.push("не может: " + p.declined.map((d) => d.name).join(", "));
  return parts.join(" · ");
}

// B5: a report without a comment is not a report. Deliberately only a
// non-empty check — a minimum length would produce the word "ок" and buy
// nothing.
export function canReportDone(comment: string): boolean {
  return comment.trim().length > 0;
}

// B3: same rule for a refusal. A refusal with no reason is the silence this
// whole system exists to stop, just with a button pressed.
export function canDecline(reason: string): boolean {
  return reason.trim().length > 0;
}

// «1/3» для доски.
//
// Полная строка («2 из 4 · сделали: … · ждём: …») осталась там, где задачу
// читают целиком, — в её карточке. На доске она занимала третью строку и
// перечисляла имена, которые всё равно не помещались. Кирилл о кубиках
// канбана сказал прямо: «убрать лишнюю бесполезную инфу… УБРАТЬ НЕНУЖНОЕ!».
//
// Пусто, когда исполнитель один: «0/1» не говорит ничего, чего не говорит
// сама задача, стоящая в столбце «Новые».
export function progressShort(participants: TaskParticipant[]): string {
  const p = taskProgress(participants);
  if (p.total < 2) return "";
  return `${p.doneCount}/${p.total}`;
}
