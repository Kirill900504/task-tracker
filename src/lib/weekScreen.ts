import type { Meeting, Task } from "@/types/tracker";
import { isTaskDueOnDate, taskSortFn } from "@/lib/taskDisplay";
import { addDaysIso } from "@/lib/calendarLogic";

// Неделя: семь дней, и в каждом — то, что на него назначено.
//
// «Что сегодня» трекер отвечал давно, «что вообще» — двумя столбцами по
// срочности. Вопрос между ними — «что на этой неделе» — задаётся чаще
// первого и не имел ответа ни на одном экране: чтобы его собрать,
// приходилось листать календарь и держать в голове задачи.
//
// Ничего нового здесь не считается и не хранится: день недели — это тот же
// `isTaskDueOnDate`, которым живут календарь и повторяющиеся задачи, и те
// же встречи. Второй источник правды про «когда» разошёлся бы с первым за
// неделю — в этом проекте это случалось трижды.
//
// Неделя начинается с ПОНЕДЕЛЬНИКА, а не с сегодняшнего дня: «эта неделя» —
// это календарная неделя, и сдвинутая на среду она перестаёт совпадать с
// тем, что человек называет неделей вслух.

export type WeekDay = {
  date: string;
  // Понедельник…воскресенье — для подписи.
  weekday: number;
  isToday: boolean;
  isPast: boolean;
  tasks: Task[];
  meetings: Meeting[];
};

export function startOfWeek(now: Date): string {
  const wd = now.getDay();
  // Воскресенье в getDay() нулевое, а в неделе оно последнее.
  const back = (wd + 6) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildWeek(tasks: Task[], meetings: Meeting[], now: Date = new Date()): WeekDay[] {
  const first = startOfWeek(now);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const open = tasks.filter((t) => t.status !== "done");

  const out: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysIso(first, i);
    const d = new Date(date + "T00:00:00");
    out.push({
      date,
      weekday: d.getDay(),
      isToday: date === today,
      isPast: date < today,
      tasks: open.filter((t) => isTaskDueOnDate(t, d)).sort((a, b) => taskSortFn(a, b, now)),
      meetings: meetings
        .filter((m) => m.date === date && (!m.status || m.status === "planned"))
        .sort((a, b) => (a.time || "").localeCompare(b.time || "")),
    });
  }
  return out;
}

// Сколько всего назначено на неделю — цифра для заголовка панели. Считается
// из того же списка, чтобы не разойтись с тем, что видно ниже.
export function weekCount(days: WeekDay[]): number {
  return days.reduce((sum, d) => sum + d.tasks.length + d.meetings.length, 0);
}
