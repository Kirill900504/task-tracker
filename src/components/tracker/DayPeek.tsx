"use client";

// «Что на этот день» — окно по правой кнопке на клетке календаря.
//
// Точки в клетке говорят только «что-то есть», а чтобы узнать что, день
// приходилось выбирать фильтром — и доска сужалась ради одного взгляда.
// Здесь взгляд стоит одно нажатие и ничего не меняет: окно показывает
// встречи и задачи дня и открывает любую карточку, а «+ Задача / + Встреча»
// повторяют левый щелчок, чтобы заглянуть и сразу добавить было одним
// движением. Списки приходят уже отобранными той же функцией, что ставит
// точки, — иначе точка и список разошлись бы на повторяющихся задачах.
import type { Meeting, Task } from "@/types/tracker";
import { fmtDate } from "@/lib/taskDisplay";

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export default function DayPeek({
  date,
  tasks,
  meetings,
  onOpenTask,
  onOpenMeeting,
  onNewTask,
  onNewMeeting,
}: {
  date: string;
  tasks: Task[];
  meetings: Meeting[];
  onOpenTask: (id: string) => void;
  onOpenMeeting: (id: string) => void;
  onNewTask: () => void;
  onNewMeeting: () => void;
}) {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  // Без времени — в конец: «когда-то в этот день» читается после расписания.
  const byTime = [...meetings].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

  return (
    <div className="day-peek" id="dayPeek">
      <div className="day-peek-head">
        {weekday}, {fmtDate(date)}
      </div>
      {byTime.length === 0 && tasks.length === 0 && <div className="day-peek-empty">На этот день ничего нет</div>}
      {byTime.length > 0 && (
        <div className="day-peek-group">
          <div className="day-peek-label">Встречи · {byTime.length}</div>
          {byTime.map((mt) => {
            const closed = mt.status === "success" || mt.status === "no_result";
            return (
              <button
                key={mt.id}
                type="button"
                className={"day-peek-row" + (closed ? " closed" : "")}
                title={closed ? "Встреча уже прошла" : undefined}
                onClick={() => onOpenMeeting(mt.id)}
              >
                <span className="day-peek-time">{mt.time || "—"}</span>
                <span className="day-peek-title">{mt.title || "Без названия"}</span>
              </button>
            );
          })}
        </div>
      )}
      {tasks.length > 0 && (
        <div className="day-peek-group">
          <div className="day-peek-label">Задачи · {tasks.length}</div>
          {tasks.map((t) => (
            <button key={t.id} type="button" className="day-peek-row" onClick={() => onOpenTask(t.id)}>
              <span className="day-peek-title">{t.title || "Без названия"}</span>
              {t.assignee && <span className="day-peek-who">{t.assignee.replace(/\s*\(я\)\s*$/, "")}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="day-peek-actions">
        <button type="button" className="date-popover-btn" onClick={onNewTask}>
          + Задача
        </button>
        <button type="button" className="date-popover-btn" onClick={onNewMeeting}>
          + Встреча
        </button>
      </div>
    </div>
  );
}
