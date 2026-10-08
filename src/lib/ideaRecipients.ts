import { withoutSelfMark } from "@/lib/actorName";

// Кому мысль ушла и что с ней сделали — по строкам рассылки
// (`idea_recipients`, миграция 0019).
//
// Строки эти существовали с самого начала, но читал их только бот: в
// трекере автор видел «Отправлено: …» четыре секунды под мыслью и больше
// никогда, а получатель не видел присланного вовсе — панель мыслей
// показывает только свои (NewTracker, `myIdeas`), и «приёмка» мысли жила
// одной кнопкой под сообщением в мессенджере. Слова Кирилла 07.10.2026:
// «оставлять при наведении мыши список, кому ранее была отправлена эта
// мысль» и «у получателя … должна так же быть какой-то формат приёмки в
// приложении на ПК и мобильной версии».
//
// Передач две (миграция 0051, решение Кирилла 23.09.2026):
// — «send», ОТПРАВИТЬ: мысль уходит из списка автора в окно
//   «Отправленные», получатель отвечает в блоке «Прислали вам»;
// — «share», ПОДЕЛИТЬСЯ: мысль остаётся у автора, а у получателя тихо
//   лежит в списке мыслей с подписью «от кого», ответа не требует.
//
// Чистые функции отдельно от хука — чтобы правило «что считается ответом»
// проверялось тестом, а не глазами.

export type IdeaShareKind = "send" | "share";

export type IdeaRecipientRow = {
  id: string;
  ideaId: string;
  assigneeId: string;
  // Старые строки (и кэш, записанный до 0051) поля не несут — это «send».
  kind?: IdeaShareKind;
  seenAt: string | null;
  convertedTaskId: string | null;
  createdAt: string;
  // Сама мысль, встроенная в ту же выборку. Пусто — мысль удалена или не
  // видна (у получателя её видимость держится на этой же строке).
  idea: { text: string; createdBy: string | null; createdAt: string; done: boolean; deletedAt: string | null } | null;
};

export function kindOf(row: Pick<IdeaRecipientRow, "kind">): IdeaShareKind {
  return row.kind === "share" ? "share" : "send";
}

// Что получатель ответил: взял в работу, принял / убрал у себя или пока
// молчит.
export type RecipientState = "taken" | "seen" | "none";

export function recipientState(row: Pick<IdeaRecipientRow, "seenAt" | "convertedTaskId">): RecipientState {
  if (row.convertedTaskId) return "taken";
  if (row.seenAt) return "seen";
  return "none";
}

// Ответ словом — для всплывашки и окна «Отправленные». У поделённой
// «ничего не ответил» — нормальное состояние, а не молчание: её просто
// видят.
export function stateLabel(kind: IdeaShareKind, state: RecipientState): string {
  if (state === "taken") return "взял в работу";
  if (kind === "share") return state === "seen" ? "убрал у себя" : "видит";
  return state === "seen" ? "принял" : "не ответил";
}

export type SentTo = { name: string; state: RecipientState; kind: IdeaShareKind };

// Для автора: у каждой мысли — кому она ушла, в порядке отправки. Имя без
// пометки «(я)»: она часть строки в базе, а не того, что читают люди.
// Человека, которого убрали из списка, не показываем вовсе — подписать его
// нечем, а «бывший участник» в списке получателей ничего не объясняет.
export function sentToByIdea(rows: IdeaRecipientRow[], nameById: Record<string, string>): Record<string, SentTo[]> {
  const out: Record<string, SentTo[]> = {};
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const row of sorted) {
    const raw = nameById[row.assigneeId];
    if (!raw) continue;
    (out[row.ideaId] ||= []).push({ name: withoutSelfMark(raw), state: recipientState(row), kind: kindOf(row) });
  }
  return out;
}

// Для автора: какие мысли ОТПРАВЛЕНЫ хотя бы одному человеку. Они уходят
// из рабочего списка в окно «Отправленные» — «отправить» и значит отдать.
// Поделённая остаётся на месте.
export function sentAwayIds(rows: IdeaRecipientRow[]): Set<string> {
  return new Set(rows.filter((r) => kindOf(r) === "send").map((r) => r.ideaId));
}

function aliveForMe(row: IdeaRecipientRow, myAssigneeId: string, myUserId: string): boolean {
  return (
    row.assigneeId === myAssigneeId &&
    recipientState(row) === "none" &&
    !!row.idea &&
    !row.idea.deletedAt &&
    !row.idea.done &&
    (row.idea.createdBy || "") !== myUserId
  );
}

// Для получателя: что мне ОТПРАВИЛИ и на что я ещё не ответил. Свежее
// сверху. Не показывается:
// — отвеченное (взял в работу, «Сохранить» или «Принял») — приёмка окончена;
// — удалённое или вычеркнутое автором — отвечать уже не на что;
// — своё: мысль, которую я отправил себе сам, уже лежит в моём списке.
export function incomingFor(rows: IdeaRecipientRow[], myAssigneeId: string, myUserId: string): IdeaRecipientRow[] {
  if (!myAssigneeId) return [];
  return rows
    .filter((row) => kindOf(row) === "send" && aliveForMe(row, myAssigneeId, myUserId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Для получателя: чем со мной ПОДЕЛИЛИСЬ — те же условия, но ответа никто
// не ждёт: мысль лежит в списке, пока я её не уберу или автор не
// вычеркнет.
export function sharedWithMe(rows: IdeaRecipientRow[], myAssigneeId: string, myUserId: string): IdeaRecipientRow[] {
  if (!myAssigneeId) return [];
  return rows
    .filter((row) => kindOf(row) === "share" && aliveForMe(row, myAssigneeId, myUserId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
