"use client";

// Port of the calendar panel from trackerMarkup.ts + renderCalendar()/
// openDatePopover()/renderCalFilterNote() in legacy-tracker.js. Drag-to-
// reschedule (dropping a meeting chip on a day) is a later phase — clicking
// a day still opens the "+ Задача / + Встреча" popover as before.
import { useState } from "react";
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
  dateTimeConfirm: ReturnType<typeof useDateTimeConfirm>;
} & PanelDragProps) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [popoverDate, setPopoverDate] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

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
                setPopoverDate(ds);
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("text/plain")) return;
                e.preventDefault();
                setDragOverDate(ds);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDate((cur) => (cur === ds ? null : cur));
              }}
              onDrop={async (e) => {
                setDragOverDate(null);
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
              {popoverDate === ds && (
                <div className="date-popover" style={{ display: "flex" }} id="datePopover" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="date-popover-btn"
                    id="datePopoverTaskBtn"
                    onClick={() => {
                      setPopoverDate(null);
                      onRequestNewTask(ds);
                    }}
                  >
                    + Задача
                  </button>
                  <button
                    type="button"
                    className="date-popover-btn"
                    id="datePopoverMeetingBtn"
                    onClick={() => {
                      setPopoverDate(null);
                      onRequestNewMeeting(ds);
                    }}
                  >
                    + Встреча
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {popoverDate && <div style={{ position: "fixed", inset: 0, zIndex: 1 }} onClick={() => setPopoverDate(null)} />}
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
