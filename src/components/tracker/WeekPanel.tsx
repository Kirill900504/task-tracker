"use client";

import { useMemo } from "react";
import type { Meeting, Task } from "@/types/tracker";
import { buildWeek, weekCount } from "@/lib/weekScreen";
import { weekdayName } from "@/lib/taskDisplay";
import PanelDragHandle, { resolveDragHandleProps, type PanelDragProps } from "./PanelDragHandle";

// Панель «Неделя»: семь дней подряд, в каждом — задачи и встречи этого дня.
//
// Задача и встреча лежат в одном ряду и выглядят одинаково: в календарном
// вопросе «что в четверг» разница между ними не важна, важно время. Всё
// открывается тем же окном, что и везде, — второй способ посмотреть задачу
// разошёлся бы с первым.
//
// Прошедшие дни недели не прячутся, а гаснут: «что уже прошло» — часть
// ответа на «как идёт неделя», и вычёркивать их значит каждый понедельник
// показывать полную неделю, а каждую пятницу — огрызок.

export default function WeekPanel({
  tasks,
  meetings,
  onOpenTask,
  onOpenMeeting,
  dragHandleProps,
  isDragging,
  dropIndicatorBefore,
}: {
  tasks: Task[];
  meetings: Meeting[];
  onOpenTask: (task: Task) => void;
  onOpenMeeting: (meeting: Meeting) => void;
} & PanelDragProps) {
  const days = useMemo(() => buildWeek(tasks, meetings), [tasks, meetings]);
  const total = weekCount(days);

  return (
    <div
      className={"panel dash-panel" + (isDragging ? " dragging" : "") + (dropIndicatorBefore ? " drag-indicator" : "")}
      data-panel-id="weekPanel"
    >
      <div className="dash-panel-head">
        <PanelDragHandle {...resolveDragHandleProps(dragHandleProps)} />
        <h2 className="panel-title">
          Неделя <span className="count">{total}</span>
        </h2>
      </div>

      {total === 0 && <div className="empty">На этой неделе ничего не назначено.</div>}

      {days.map((d) => {
        const empty = !d.tasks.length && !d.meetings.length;
        // Пустые дни показываются строкой с датой и ничем больше: без них
        // неделя перестаёт быть неделей и превращается в список из трёх
        // дат, по которому не видно, что четверг свободен.
        return (
          <div key={d.date} className={"week-day" + (d.isToday ? " today" : "") + (d.isPast ? " past" : "")}>
            <div className="week-day-head">
              <span className="week-day-name">{weekdayName(d.weekday)}</span>
              <span className="week-day-date">{d.date.slice(8, 10) + "." + d.date.slice(5, 7)}</span>
            </div>
            {empty && <div className="week-day-empty">—</div>}
            {d.meetings.map((m) => (
              <button key={m.id} type="button" className="week-item meeting" onClick={() => onOpenMeeting(m)}>
                {m.time && <span className="week-item-time">{m.time}</span>}
                <span className="week-item-title">{m.title}</span>
              </button>
            ))}
            {d.tasks.map((t) => (
              <button key={t.id} type="button" className={"week-item" + (t.priority === "high" ? " high" : "")} onClick={() => onOpenTask(t)}>
                <span className="week-item-title">{t.title}</span>
                {t.assignee && <span className="week-item-who">{t.assignee}</span>}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
