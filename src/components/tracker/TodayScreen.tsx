"use client";

import type { Meeting, Section, Task } from "@/types/tracker";
import TaskCard from "./TaskCard";
import { buildToday } from "@/lib/todayScreen";
import { fmtDate } from "@/lib/taskDisplay";

// The phone's first screen: what is overdue, what is due today, who you are
// meeting. The same cards as everywhere else — tapping opens the same
// editor, the checkbox completes the same way — so nothing here is a second,
// slightly different version of the tracker.

export default function TodayScreen({
  tasks,
  meetings,
  sections,
  onToggleTask,
  onOpenTask,
  onOpenMeeting,
  onGoToTasks,
}: {
  tasks: Task[];
  meetings: Meeting[];
  sections: Section[];
  onToggleTask: (task: Task) => void;
  onOpenTask: (task: Task) => void;
  onOpenMeeting: (meeting: Meeting) => void;
  onGoToTasks: () => void;
}) {
  const data = buildToday(tasks, meetings);
  const sectionOf = (t: Task) => sections.find((s) => s.id === t.sectionId) ?? null;
  const nothing = !data.overdue.length && !data.dueToday.length && !data.meetingsToday.length && !data.meetingsTomorrow.length;

  return (
    <div className="today-screen" id="todayScreen">
      {nothing && (
        <div className="today-empty">
          <div className="today-empty-mark">✓</div>
          <div className="today-empty-title">На сегодня чисто</div>
          <div className="today-empty-sub">
            {data.undatedCount > 0 ? `Без срока лежит ${data.undatedCount} — можно разобрать` : "Ни просроченного, ни встреч"}
          </div>
          {data.undatedCount > 0 && (
            <button className="btn btn-small" onClick={onGoToTasks}>
              Открыть задачи
            </button>
          )}
        </div>
      )}

      {data.overdue.length > 0 && (
        <section className="today-block">
          <h3 className="today-heading overdue">Просрочено · {data.overdue.length}</h3>
          {data.overdue.map((task) => (
            <TaskCard key={task.id} task={task} section={sectionOf(task)} onToggleDone={() => onToggleTask(task)} onOpen={() => onOpenTask(task)} />
          ))}
        </section>
      )}

      {data.dueToday.length > 0 && (
        <section className="today-block">
          <h3 className="today-heading">На сегодня · {data.dueToday.length}</h3>
          {data.dueToday.map((task) => (
            <TaskCard key={task.id} task={task} section={sectionOf(task)} onToggleDone={() => onToggleTask(task)} onOpen={() => onOpenTask(task)} />
          ))}
        </section>
      )}

      {data.meetingsToday.length > 0 && (
        <section className="today-block">
          <h3 className="today-heading">Встречи сегодня · {data.meetingsToday.length}</h3>
          {data.meetingsToday.map((meeting) => (
            <button className="today-meeting" key={meeting.id} onClick={() => onOpenMeeting(meeting)}>
              <span className="today-meeting-time">{meeting.time || "--:--"}</span>
              <span className="today-meeting-title">{meeting.title}</span>
              {!!meeting.participants?.length && <span className="today-meeting-people">👥 {meeting.participants.length}</span>}
            </button>
          ))}
        </section>
      )}

      {data.meetingsTomorrow.length > 0 && (
        <section className="today-block">
          <h3 className="today-heading muted">Завтра · {fmtDate(data.meetingsTomorrow[0].date)}</h3>
          {data.meetingsTomorrow.map((meeting) => (
            <button className="today-meeting muted" key={meeting.id} onClick={() => onOpenMeeting(meeting)}>
              <span className="today-meeting-time">{meeting.time || "--:--"}</span>
              <span className="today-meeting-title">{meeting.title}</span>
            </button>
          ))}
        </section>
      )}

      {!nothing && data.undatedCount > 0 && (
        <button className="today-undated" onClick={onGoToTasks}>
          Без срока: {data.undatedCount} — посмотреть
        </button>
      )}
    </div>
  );
}
