// Что руководитель видит первым и что ему вообще можно нажать.
//
// Split out of the screen itself so these rules are testable without a
// browser and without a database — they are the part that decides whether a
// person opening the tracker sees the thing he owes an answer on, or has to
// hunt for it.

export type WorkState = {
  role: "executor" | "coexecutor" | "watcher";
  acceptedAt: string | null;
  doneAt: string | null;
  declinedAt: string | null;
  deadline: string;
  approvalState: string;
};

export type WorkGroup = "new" | "work" | "done";

// Три группы, в порядке, в котором они его касаются: на что ответить, что
// в работе, что позади. Отказ — не «сделано»: задача осталась, ответ дан,
// и держать её среди законченных значит потерять её из виду обоим.
export function workGroup(t: WorkState): WorkGroup {
  if (t.doneAt || t.approvalState === "accepted") return "done";
  if (t.acceptedAt || t.declinedAt) return "work";
  return "new";
}

export function isOverdueFor(t: WorkState, today: string): boolean {
  if (!t.deadline || t.doneAt) return false;
  return t.deadline < today;
}

// Ближайший срок первым, «без срока» — в конец: несделанное с датой всегда
// важнее несделанного без неё.
export function byDeadline<T extends { deadline: string }>(a: T, b: T): number {
  return (a.deadline || "9999-99-99").localeCompare(b.deadline || "9999-99-99");
}

// Отвечает только исполнитель, и только пока есть на что отвечать.
// Наблюдателю и соисполнителю кнопки не показываются вовсе — предлагать
// действие, которое база всё равно отклонит, хуже, чем не предлагать.
export function canAnswer(t: WorkState): boolean {
  return t.role === "executor" && !t.doneAt && t.approvalState !== "accepted";
}
