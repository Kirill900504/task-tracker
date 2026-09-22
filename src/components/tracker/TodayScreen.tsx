"use client";

import { useState } from "react";
import type { Meeting, Section, Task } from "@/types/tracker";
import TaskCard from "./TaskCard";
import SendMenu from "./SendMenu";
import { buildToday } from "@/lib/todayScreen";
import { fmtDate } from "@/lib/taskDisplay";
import { useTaskParticipants } from "@/hooks/useTaskParticipants";
import { useAuthors } from "@/hooks/useAuthors";
import { authorLabel } from "@/lib/authorName";
import { myRoleOn } from "@/lib/myRole";

// The phone's first screen: what is overdue, what is due today, who you are
// meeting. The same cards as everywhere else — tapping opens the same
// editor, the checkbox completes the same way — so nothing here is a second,
// slightly different version of the tracker.

export default function TodayScreen({
  tasks,
  meetings,
  sections,
  onToggleTask,
  canCompleteTask,
  onOpenTask,
  onOpenMeeting,
  onGoToTasks,
  myAssigneeId = "",
  showToast,
}: {
  tasks: Task[];
  meetings: Meeting[];
  sections: Section[];
  onToggleTask: (task: Task) => void;
  // Закрыть задачу галочкой может только тот, кто её поставил, — то же
  // правило, что и на доске (см. TaskCard.canComplete). Исполнителю здесь
  // остаётся открыть карточку и ответить в ней.
  canCompleteTask?: (task: Task) => boolean;
  onOpenTask: (task: Task) => void;
  onOpenMeeting: (meeting: Meeting) => void;
  // Необязателен: на телефоне это переход на вкладку «Задачи», а на
  // компьютере панель задач и так стоит рядом — вести из неё некуда.
  onGoToTasks?: () => void;
  // Моя строка в списке людей: по ней карточка узнаёт, кем я в задаче
  // числюсь, и красится тем же тоном, что на доске.
  myAssigneeId?: string;
  // How the outcome of a send is said out loud here — the same toast stack
  // the rest of the tracker answers with.
  showToast: (message: string) => void;
}) {
  // Sending straight from the first screen: what you are about to miss is
  // exactly what you most often want to hand to someone.
  const [sendTask, setSendTask] = useState<Task | null>(null);
  const sendMenuFor = (task: Task) => [{ id: "send", label: "✈ Отправить участнику", onSelect: () => setSendTask(task) }];
  const data = buildToday(tasks, meetings);
  const sectionOf = (t: Task) => sections.find((s) => s.id === t.sectionId) ?? null;
  // Тон карточки здесь тот же, что на доске, и по той же причине: этот
  // экран показывает ВСЁ, у чего срок сегодня или раньше, — и своё, и
  // чужое, — а без цвета «где моя работа» приходится открывать каждую.
  //
  // Участники спрашиваются своим хуком, а не приходят пропсом: держит их
  // панель задач, и подниматься за ними в NewTracker значило бы тащить
  // список участия через весь корень ради цвета на втором экране. Цена
  // известна и мала — вторая подписка на ту же таблицу (имя канала у хука
  // своё на каждый вызов ровно для этого, см. useTaskParticipants).
  const participants = useTaskParticipants();
  const roleOf = (t: Task) => myRoleOn(participants.forTask(t.id), myAssigneeId);
  // «Кто поручил → кому» — здесь то же, что на доске: одно правило на все
  // места, где показывается кубик задачи (см. TaskCard).
  const authors = useAuthors();
  const people = participants.people.map((p) => p.name);
  const authorOf = (t: Task) => authorLabel(t.createdBy, authors, people);
  const executorsOf = (t: Task) =>
    participants
      .forTask(t.id)
      .filter((p) => p.role === "executor")
      .map((p) => p.name)
      .filter(Boolean);
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
          {data.undatedCount > 0 && onGoToTasks && (
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
            <TaskCard
              key={task.id}
              task={task}
              section={sectionOf(task)}
              role={roleOf(task)}
              onToggleDone={() => onToggleTask(task)}
              canComplete={canCompleteTask ? canCompleteTask(task) : true}
              onOpen={() => onOpenTask(task)}
              menuItems={sendMenuFor(task)}
              authorName={authorOf(task)}
              executors={executorsOf(task)}
            />
          ))}
        </section>
      )}

      {data.dueToday.length > 0 && (
        <section className="today-block">
          <h3 className="today-heading">На сегодня · {data.dueToday.length}</h3>
          {data.dueToday.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              section={sectionOf(task)}
              role={roleOf(task)}
              onToggleDone={() => onToggleTask(task)}
              canComplete={canCompleteTask ? canCompleteTask(task) : true}
              onOpen={() => onOpenTask(task)}
              menuItems={sendMenuFor(task)}
              authorName={authorOf(task)}
              executors={executorsOf(task)}
            />
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

      {sendTask && (
        <SendMenu
          kind="task"
          id={sendTask.id}
          concerns={[sendTask.assignee]}
          anchor={null}
          onClose={() => setSendTask(null)}
          onResult={showToast}
        />
      )}

      {!nothing && data.undatedCount > 0 && onGoToTasks && (
        <button className="today-undated" onClick={onGoToTasks}>
          Без срока: {data.undatedCount} — посмотреть
        </button>
      )}
    </div>
  );
}
