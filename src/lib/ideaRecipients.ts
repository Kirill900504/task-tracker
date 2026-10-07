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
// Чистые функции отдельно от хука — чтобы правило «что считается ответом»
// проверялось тестом, а не глазами.

export type IdeaRecipientRow = {
  id: string;
  ideaId: string;
  assigneeId: string;
  seenAt: string | null;
  convertedTaskId: string | null;
  createdAt: string;
  // Сама мысль, встроенная в ту же выборку. Пусто — мысль удалена или не
  // видна (у получателя её видимость держится на этой же строке).
  idea: { text: string; createdBy: string | null; createdAt: string; done: boolean; deletedAt: string | null } | null;
};

// Что получатель ответил: взял в работу, принял к сведению или пока молчит.
export type RecipientState = "taken" | "seen" | "none";

export function recipientState(row: Pick<IdeaRecipientRow, "seenAt" | "convertedTaskId">): RecipientState {
  if (row.convertedTaskId) return "taken";
  if (row.seenAt) return "seen";
  return "none";
}

export type SentTo = { name: string; state: RecipientState };

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
    (out[row.ideaId] ||= []).push({ name: withoutSelfMark(raw), state: recipientState(row) });
  }
  return out;
}

// Для получателя: что прислали мне и на что я ещё не ответил. Свежее
// сверху. Не показывается:
// — отвеченное (взял в работу или «Принял») — приёмка закончена;
// — удалённое или вычеркнутое автором — отвечать уже не на что;
// — своё: мысль, которую я отправил себе сам, уже лежит в моём списке.
export function incomingFor(rows: IdeaRecipientRow[], myAssigneeId: string, myUserId: string): IdeaRecipientRow[] {
  if (!myAssigneeId) return [];
  return rows
    .filter(
      (row) =>
        row.assigneeId === myAssigneeId &&
        recipientState(row) === "none" &&
        !!row.idea &&
        !row.idea.deletedAt &&
        !row.idea.done &&
        (row.idea.createdBy || "") !== myUserId,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
