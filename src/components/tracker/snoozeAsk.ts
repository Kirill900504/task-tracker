import type { AskApi } from "@/components/Ask";
import { isSnoozed, snoozeChoices, snoozeDay, snoozePastDeadline } from "@/lib/snooze";

// Вопрос «до какого дня отложить» — один на все двери: кнопку в строке
// срока внутри задачи и пункт меню карточки. Две копии этого вопроса
// разошлись бы вариантами, а варианты здесь и есть весь механизм.
//
// Ответ: дата (отложить), "" (вернуть сейчас), null (передумали).
export async function chooseSnooze(
  ask: AskApi,
  task: { snoozedUntil?: string; deadline?: string },
  today: string,
): Promise<string | null> {
  const snoozed = isSnoozed(task.snoozedUntil, today);
  const choice = await ask.choose({
    title: "Отложить до…",
    question: snoozed ? `Сейчас отложена до ${snoozeDay(task.snoozedUntil || "")}.` : "Когда вернуть задачу на доску?",
    note:
      "До этого дня задача не мешает на вашей доске — найти её можно кнопкой «Отложено» над доской. В сам день она вернётся, и бот напомнит. У исполнителей всё остаётся как было." +
      (task.deadline ? ` Срок — ${snoozeDay(task.deadline)}.` : ""),
    options: [
      ...(snoozed ? [{ value: "", label: "Вернуть на доску сейчас" }] : []),
      ...snoozeChoices(today, task.deadline).filter((o) => o.value !== task.snoozedUntil),
    ],
  });
  if (choice === null) return null;
  if (snoozePastDeadline(choice, task.deadline)) {
    const yes = await ask.confirm({
      question: `Задача вернётся ${snoozeDay(choice)}, а срок у неё — ${snoozeDay(task.deadline || "")}.`,
      note: "То есть вы увидите её уже просроченной. Если срок на самом деле сдвигается, перенесите и его.",
      okText: "Всё равно отложить",
    });
    if (!yes) return null;
  }
  return choice;
}
