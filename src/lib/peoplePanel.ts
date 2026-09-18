import type { Task } from "@/types/tracker";
import { sortByPeopleOrder } from "@/lib/peopleOrder";
import { isOverdue } from "@/lib/taskDisplay";

// Кто чем занят — одной строкой на человека.
//
// Четырнадцать человек, и единственный способ узнать, у кого что, был
// фильтр по исполнителю: выбрать одного, посмотреть, выбрать следующего.
// Понедельничная сводка отвечает на тот же вопрос, но раз в неделю и в
// мессенджере — а спрашивают его каждый день и глядя в трекер.
//
// Считается из самих задач, а не из строк участия. Не для простоты: строки
// участия живут отдельным слоем со своей подпиской, и вторая такая же
// подписка ради панели означала бы, что одно и то же считается в трекере
// дважды и однажды разойдётся. Задача несёт имя исполнителя, срок, статус,
// отметку «принял» и состояние приёмки — этого хватает на все четыре цифры.
//
// Цена решения названа честно: у задачи на нескольких видно только первого
// исполнителя (tasks.assignee), поэтому соисполнители в эти цифры не
// попадают. Для вопроса «у кого что горит» это несущественно, а для
// «отчитались все или нет» есть карточка.

export type PersonLoad = {
  name: string;
  // Открытые задачи, где он назван исполнителем.
  open: number;
  // Из них просроченные.
  overdue: number;
  // Из них те, по которым он не нажал ничего.
  silent: number;
  // Сданные им и ждущие приёмки.
  review: number;
};

export function peopleLoad(tasks: Task[], names: string[]): PersonLoad[] {
  const byName = new Map<string, PersonLoad>();
  const ensure = (name: string) => {
    let row = byName.get(name);
    if (!row) {
      row = { name, open: 0, overdue: 0, silent: 0, review: 0 };
      byName.set(name, row);
    }
    return row;
  };

  for (const task of tasks) {
    const name = (task.assignee || "").trim();
    if (!name) continue;
    if (task.status === "done") continue;
    const row = ensure(name);
    if (task.approvalState === "awaiting_review") {
      // Сданное не «в работе»: оно ждёт не его, а Кирилла, и складывать
      // одно с другим значит показать человеку долг, которого у него нет.
      row.review++;
      continue;
    }
    row.open++;
    if (isOverdue(task)) row.overdue++;
    if (!task.acceptedAt) row.silent++;
  }

  // Люди без единой открытой задачи в панели не нужны: она отвечает на
  // «у кого что», а не «кто у нас есть» — для этого «Команда».
  const withWork = names.filter((n) => byName.has(n));
  const rows = sortByPeopleOrder(withWork, (n) => n).map((n) => byName.get(n)!);

  // Сверху тот, у кого горит. Порядок людей во всём трекере один
  // (peopleOrder), но здесь вопрос не «кто это», а «к кому идти первым».
  return rows.sort((a, b) => b.overdue - a.overdue || b.silent - a.silent || b.open - a.open);
}
