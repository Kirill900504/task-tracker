// What an answer does to the person's own participation row — applied on
// screen BEFORE the server confirms it.
//
// 07.10.2026, его словами: «трекер работает медленно». «Принял» в карточке
// ждал сначала маршрут (0,3–0,5 с), а потом ещё полное перечитывание всего
// участия (0,2–0,4 с на телефоне), и только тогда на экране что-то
// менялось — почти секунда на кнопку, которую нажимают десятки раз в день.
// Так делают ведущие трекеры (Linear, Todoist): экран меняется сразу,
// запрос идёт следом, а отказ сервера откатывает экран и называет причину.
// Правила (обязательный комментарий, переход на приёмку, сообщение
// постановщику) по-прежнему живут в маршруте — здесь только то, что
// человек и так увидит через полсекунды.

export type AnswerPayload = {
  action: string;
  comment?: string;
  date?: string | null;
};

export type ParticipantAnswerFields = {
  acceptedAt: string | null;
  doneAt: string | null;
  doneComment: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  rescheduleTo: string | null;
  rescheduleReason: string | null;
};

export function answerPatch(payload: AnswerPayload, now: string): Partial<ParticipantAnswerFields> | null {
  const comment = (payload.comment || "").trim();
  switch (payload.action) {
    case "accept":
      return { acceptedAt: now };
    case "done":
      // Как и в маршруте: отчёт снимает прежний отказ и просьбу о переносе.
      return { doneAt: now, doneComment: comment, declinedAt: null, declineReason: null, rescheduleTo: null, rescheduleReason: null };
    case "decline":
      return { declinedAt: now, declineReason: comment, doneAt: null, doneComment: null };
    case "reschedule":
      return { rescheduleTo: payload.date || null, rescheduleReason: comment };
    default:
      return null;
  }
}
