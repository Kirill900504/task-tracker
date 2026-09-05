"use client";

// Port of the calendar panel from trackerMarkup.ts + renderCalendar()/
// openDatePopover()/renderCalFilterNote() in legacy-tracker.js. Drag-to-
// reschedule (dropping a meeting chip on a day) is a later phase — clicking
// a day still opens the "+ Задача / + Встреча" popover as before.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Meeting, Task } from "@/types/tracker";
import { dateStr, fmtDate, isTaskDueOnDate, todayStr } from "@/lib/taskDisplay";
import { getMonthGridDates } from "@/lib/calendarLogic";
import type { useDateTimeConfirm } from "@/hooks/useDateTimeConfirm";
import PanelDragHandle, { resolveDragHandleProps, type PanelDragProps } from "./PanelDragHandle";

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
  dropIndicatorBefore,
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
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

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

  // Esc closes it, same as legacy's global keydown handler.
  useEffect(() => {
    if (!popover) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPopover(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [popover]);

  const today = todayStr();
  const gridDates = getMonthGridDates(viewDate);

  return (
    <div className={"panel dash-panel" + (isDragging ? " dragging" : "") + (dropIndicatorBefore ? " drag-indicator" : "")} id="calPanel" data-panel-id="calPanel">
      <div className="dash-panel-head">
        <PanelDragHandle {...resolveDragHandleProps(dragHandleProps)} />
        <div className="panel-title">Календарь</div>
      </div>
      <div className="cal-nav">
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
            <div
              key={ds}
              className={
                "cal-day" +
                (cd.getMonth() !== viewDate.getMonth() ? " other-month" : "") +
                (ds === today ? " today" : "") +
                (ds === selectedDate ? " selected" : "") +
                (dragOverDate === ds ? " drag-over" : "")
              }
              onClick={(e) => {
                e.stopPropagation();
                setPopover({ date: ds, anchor: e.currentTarget.getBoundingClientRect() });
              }}
              onDragOver={(e) => {
                const t = e.dataTransfer.types;
                if (!t.includes("text/plain") && !t.includes("application/x-idea-id") && !t.includes("application/x-task-id")) return;
                e.preventDefault();
                setDragOverDate(ds);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDate((cur) => (cur === ds ? null : cur));
              }}
              onDrop={async (e) => {
                setDragOverDate(null);
                const ideaId = e.dataTransfer.getData("application/x-idea-id");
                if (ideaId) {
                  e.preventDefault();
                  onIdeaDroppedOnDate(ideaId, ds);
                  return;
                }
                const taskId = e.dataTransfer.getData("application/x-task-id");
                if (taskId) {
                  e.preventDefault();
                  onTaskDroppedOnDate(taskId, ds);
                  return;
                }
                const meetingId = e.dataTransfer.getData("text/plain");
                if (!meetingId) return;
                e.preventDefault();
                const meeting = meetings.find((m) => m.id === meetingId);
                if (!meeting) return;
                const result = await dateTimeConfirm.ask(`Перенести встречу «${meeting.title}» на:`, ds, meeting.time || "10:00");
                if (!result) return;
                onRescheduleMeeting(meeting, result.date, result.time);
              }}
              style={{ position: "relative" }}
            >
              {cd.getDate()}
              {dueTasks.length > 0 && <div className={"cal-dot" + (hasHigh ? " high" : "")} />}
              {dayMeetings.length > 0 && <div className="cal-dot meeting" style={{ marginTop: dueTasks.length ? 2 : 3 }} />}
            </div>
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
