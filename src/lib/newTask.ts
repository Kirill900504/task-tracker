// Как выглядит только что заведённая задача — один ответ на всех.
//
// Заводить задачи на сервере умеют четыре места: бот по фразе, разбор
// надиктованного совещания, «взять мысль в работу» в трекере и та же кнопка
// в мессенджере. Каждое собирало строку само, и умолчания у них разошлись:
// где-то `term` был "short", где-то его не было вовсе (и Postgres ставил
// своё), где-то `recur` заполнялся, где-то нет, а `created_by` проставляли
// два места из четырёх — из-за чего уведомление об отчёте не знало, кому
// адресоваться (см. notifyAuthor).
//
// Разница нигде не была осознанной. Она просто накапливалась, пока каждое
// место писали отдельно, и вылезала не там, где её сделали: задача, заведённая
// голосом, вела себя чуть иначе, чем та же задача из карточки.
//
// Поле `assignee` здесь — не украшение: с миграции 0024 имя, за которым стоит
// известный человек, само заводит строку участия. Уведомить его это не может,
// поэтому рядом всё равно нужен attachExecutors.
//
// Идентификатор передаётся снаружи, а не делается здесь: его приставка
// говорит, откуда задача взялась («bot…», «tg…», «t…»), и однажды это
// оказалось единственным, по чему удалось найти путь, терявший исполнителей.

export type NewTaskRow = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  assignee: string;
  priority: "high" | "med";
  term: "short" | "long";
  status: "in_progress";
  deadline: string | null;
  recur: "none";
  created_by: string | null;
};

export function newTaskRow(input: {
  id: string;
  userId: string;
  title: string;
  description?: string;
  assignee?: string;
  priority?: string;
  term?: string;
  deadline?: string | null;
  // Кто поручил. Пусто означает владельца пространства — так это и читает
  // notifyAuthor.
  createdBy?: string | null;
}): NewTaskRow {
  return {
    id: input.id,
    user_id: input.userId,
    title: input.title,
    description: input.description || "",
    assignee: (input.assignee || "").trim(),
    priority: input.priority === "high" ? "high" : "med",
    term: input.term === "long" ? "long" : "short",
    // Новая задача всегда в работе: «done» у только что созданной означало
    // бы, что её завели уже сделанной, и такого пути здесь нет.
    status: "in_progress",
    deadline: input.deadline || null,
    recur: "none",
    created_by: input.createdBy || null,
  };
}
