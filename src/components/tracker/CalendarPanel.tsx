"use client";

// Port of the calendar panel from trackerMarkup.ts + renderCalendar()/
// openDatePopover()/renderCalFilterNote() in legacy-tracker.js. Drag-to-
// reschedule (dropping a meeting chip on a day) is a later phase — clicking
// a day still opens the "+ Задача / + Встреча" popover as before.
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { createPortal } from "react-dom";
import type { Meeting, Task } from "@/types/tracker";
import { dateStr, fmtDate, isTaskDueOnDate, todayStr } from "@/lib/taskDisplay";
import { getMonthGridDates } from "@/lib/calendarLogic";
import type { useDateTimeConfirm } from "@/hooks/useDateTimeConfirm";
import PanelDragHandle, { resolveDragHandleProps, type PanelDragProps } from "./PanelDragHandle";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useDragState, useDropHandler, type DropTarget } from "./dnd/TrackerDnd";

const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export default function CalendarPanel({
  tasks,
  meetings,
  selectedDate,
  onSelectDate,
  onRequestNewTask,
  onRequestNewMeeting,
  onRescheduleMeeting,
  onIdeaDroppedOnDate,
  onTaskDroppedOnDate,
  dateTimeConfirm,
  dragHandleProps,
  isDragging,
}: {
  tasks: Task[];
  meetings: Meeting[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  onRequestNewTask: (date: string) => void;
  onRequestNewMeeting: (date: string) => void;
  // Dropping a meeting chip on a day just moves it (date/time only, after
  // confirming via the shared styled date/time dialog) — a lighter
  // operation than the "reschedule" quick-action icon, which instead
  // creates a follow-up meeting and resolves the original one.
  onRescheduleMeeting: (meeting: Meeting, newDate: string, newTime: string) => void;
  // Dropping an idea or a task on a day turns it into a meeting on that date:
  // the parent opens the meeting modal pre-filled with the title and date, so
  // participants and time are chosen in the normal form before saving.
  onIdeaDroppedOnDate: (ideaId: string, date: string) => void;
  onTaskDroppedOnDate: (taskId: string, date: string) => void;
  dateTimeConfirm: ReturnType<typeof useDateTimeConfirm>;
} & PanelDragProps) {
  const [viewDate, setViewDate] = useState(() => new Date());
  // The popover is portalled to <body> and positioned from the clicked cell's
  // rect — a direct port of legacy's openDatePopover(). Rendering it inside the
  // cell instead would trap it: .dash-panel sets container-type, which makes it
  // the containing block for position:fixed children, and the panel's own
  // scroll would clip it near the bottom of the list.
  const [popover, setPopover] = useState<{ date: string; anchor: DOMRect } | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Placed by writing to the DOM once measured (its own size decides whether
  // it fits below the cell), then flipped above / pulled inside the viewport
  // edges — the same math legacy's openDatePopover() used.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!popover || !el) return;
    const r = popover.anchor;
    let top = r.bottom + 4;
    if (top + el.offsetHeight > window.innerHeight - 8) top = r.top - el.offsetHeight - 4;
    el.style.top = top + "px";
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)) + "px";
  }, [popover]);

  // Esc закрывает — как и любое другое окно трекера.
  useEscapeToClose(() => setPopover(null), !!popover);

  const today = todayStr();
  const gridDates = getMonthGridDates(viewDate);

  // Что значит «бросить на день». Три разных ответа, и каждый принадлежит
  // календарю: мысль и задача становятся встречей на эту дату, встреча —
  // переезжает, спросив о времени.
  useDropHandler("idea", (ideaId, target) => {
    if (target.kind !== "day") return;
    onIdeaDroppedOnDate(ideaId, target.date);
  });
  useDropHandler("task", (taskId, target) => {
    if (target.kind !== "day") return;
    onTaskDroppedOnDate(taskId, target.date);
  });
  useDropHandler("meeting", async (meetingId, target) => {
    if (target.kind !== "day") return;
    const meeting = meetings.find((m) => m.id === meetingId);
    if (!meeting) return;
    const result = await dateTimeConfirm.ask(`Перенести встречу «${meeting.title}» на:`, target.date, meeting.time || "10:00");
    if (!result) return;
    onRescheduleMeeting(meeting, result.date, result.time);
  });

  return (
    <div className={"panel dash-panel" + (isDragging ? " dragging" : "")} id="calPanel" data-panel-id="calPanel">
      {/* Отдельной строки с надписью «КАЛЕНДАРЬ» больше нет: сетка месяца и
          так ни на что другое не похожа, а строка стоила высоты, которой в
          рабочем поле всегда не хватает. Ручка перетаскивания переехала в
          строку месяца — переставлять панели по-прежнему можно. */}
      <div className="cal-nav">
        <PanelDragHandle {...resolveDragHandleProps(dragHandleProps)} />
        <button className="btn btn-small" id="calPrevBtn" onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
          ←
        </button>
        <div className="cal-month" id="calMonthLabel">
          {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
        </div>
        <button className="btn btn-small" id="calNextBtn" onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
          →
        </button>
      </div>
      <div className="cal-grid" id="calGrid" style={{ position: "relative" }}>
        {WEEKDAY_NAMES.map((wd) => (
          <div className="cal-wd" key={wd}>
            {wd}
          </div>
        ))}
        {gridDates.map((cd) => {
          const ds = dateStr(cd);
          const dueTasks = tasks.filter((t) => t.status !== "done" && isTaskDueOnDate(t, cd));
          const hasHigh = dueTasks.some((t) => t.priority === "high");
          const dayMeetings = meetings.filter((m) => m.date === ds);
          return (
            <CalendarDay
              key={ds}
              date={ds}
              className={
                "cal-day" +
                (cd.getMonth() !== viewDate.getMonth() ? " other-month" : "") +
                (ds === today ? " today" : "") +
                (ds === selectedDate ? " selected" : "")
              }
              onClick={(rect) => setPopover({ date: ds, anchor: rect })}
            >
              {cd.getDate()}
              {dueTasks.length > 0 && <div className={"cal-dot" + (hasHigh ? " high" : "")} />}
              {dayMeetings.length > 0 && <div className="cal-dot meeting" style={{ marginTop: dueTasks.length ? 2 : 3 }} />}
            </CalendarDay>
          );
        })}
      </div>
      {popover &&
        createPortal(
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 299 }} onClick={() => setPopover(null)} />
            <div
              ref={popoverRef}
              className="date-popover"
              style={{ display: "flex", top: -9999, left: -9999 }}
              id="datePopover"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="date-popover-btn"
                id="datePopoverTaskBtn"
                onClick={() => {
                  const d = popover.date;
                  setPopover(null);
                  onRequestNewTask(d);
                }}
              >
                + Задача
              </button>
              <button
                type="button"
                className="date-popover-btn"
                id="datePopoverMeetingBtn"
                onClick={() => {
                  const d = popover.date;
                  setPopover(null);
                  onRequestNewMeeting(d);
                }}
              >
                + Встреча
              </button>
            </div>
          </>,
          document.body,
        )}
      {selectedDate && (
        <div className="cal-filter-note" id="calFilterNote" style={{ display: "flex" }}>
          <span id="calFilterText">Показаны задачи на {fmtDate(selectedDate)}</span>
          <button className="btn btn-small" id="calAddMeetingBtn" onClick={() => onRequestNewMeeting(selectedDate)}>
            + Встреча
          </button>
          <button className="btn btn-small" id="calClearBtn" onClick={() => onSelectDate(null)}>
            Показать все даты
          </button>
        </div>
      )}
    </div>
  );
}

// Клетка дня, принимающая сброс. Отдельным компонентом, потому что
// useDroppable — хук: в теле цикла его не вызвать.
function CalendarDay({
  date,
  className,
  onClick,
  children,
}: {
  date: string;
  className: string;
  onClick: (rect: DOMRect) => void;
  children: ReactNode;
}) {
  const { active } = useDragState();
  const { setNodeRef, isOver } = useDroppable({ id: "day:" + date, data: { target: { kind: "day", date } as DropTarget } });
  // Подсветка — только когда несут то, что день умеет принять. Раньше
  // подсвечивалось всё подряд, и «сюда можно» означало ровно столько же,
  // сколько «сюда нельзя».
  const welcoming = isOver && (active?.kind === "idea" || active?.kind === "task" || active?.kind === "meeting");

  return (
    <div
      ref={setNodeRef}
      className={className + (welcoming ? " drag-over" : "")}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e.currentTarget.getBoundingClientRect());
      }}
      style={{ position: "relative" }}
    >
      {children}
    </div>
  );
}
