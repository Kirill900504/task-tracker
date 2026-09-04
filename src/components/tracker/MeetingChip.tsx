"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Meeting } from "@/types/tracker";
import { fmtDate } from "@/lib/taskDisplay";
import { sanitizeAssigneeList } from "@/lib/trackerRows";

export default function MeetingChip({
  meeting,
  selectedDay,
  onOpen,
  onDelete,
  onQuickStatus,
  onQuickReschedule,
  justCreated,
}: {
  meeting: Meeting;
  selectedDay: string | null;
  onOpen: () => void;
  onDelete: () => void;
  onQuickStatus: (status: "success" | "no_result") => void;
  onQuickReschedule: () => void;
  justCreated?: boolean;
}) {
  // The participants tooltip lives in <body> and is positioned from the
  // anchor's rect, exactly as legacy's showPeopleTooltip() did: the meetings
  // list scrolls (#meetingsForDay{overflow:auto}), so a tooltip nested inside
  // a chip gets clipped for meetings near the bottom of the list.
  const [peopleAnchor, setPeopleAnchor] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const participants = sanitizeAssigneeList(meeting.participants);
  const showQuickActions = !meeting.status || meeting.status === "planned";

  // Placed by writing to the DOM once it has been measured (its own size
  // decides whether it fits below the anchor), before paint — the same
  // getBoundingClientRect math legacy's showPeopleTooltip() used.
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!peopleAnchor || !el) return;
    let top = peopleAnchor.bottom + 4;
    if (top + el.offsetHeight > window.innerHeight - 8) top = peopleAnchor.top - el.offsetHeight - 4;
    el.style.top = top + "px";
    el.style.left = Math.max(8, peopleAnchor.right - el.offsetWidth) + "px";
  }, [peopleAnchor]);

  return (
    <div
      className={
        "meeting-chip" +
        (meeting.date === selectedDay ? " selected-day" : "") +
        (meeting.status && meeting.status !== "planned" ? " resolved" : "") +
        (justCreated ? " just-created" : "")
      }
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", meeting.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
    >
      <div style={{ display: "flex", minWidth: 0, flex: "1 1 100%", gap: 8 }}>
        <span className="mwhen">
          <span className="mdate">{fmtDate(meeting.date)}</span>
          <span className="mtime">{meeting.time || "--:--"}</span>
        </span>
        <span className="mtitle">{meeting.title}</span>
        {meeting.status === "success" && (
          <span className="mstatus success" title="Успешно завершена">
            ✅
          </span>
        )}
        {meeting.status === "no_result" && (
          <span className="mstatus no_result" title={meeting.movedToDate ? "Перенесена на " + fmtDate(meeting.movedToDate) : "Без результата"}>
            🚫
          </span>
        )}
      </div>

      {participants.length > 0 && (
        <span
          className="mpeople"
          onMouseEnter={(e) => setPeopleAnchor(e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setPeopleAnchor(null)}
        >
          👥 {participants.length}
        </span>
      )}
      {peopleAnchor &&
        createPortal(
          <div ref={tooltipRef} id="peopleTooltip" className="people-tooltip" style={{ display: "block", top: -9999, left: -9999 }}>
            {participants.map((p) => (
              <div className="prow" key={p}>
                {p}
              </div>
            ))}
          </div>,
          document.body,
        )}

      {showQuickActions && (
        <div className="meeting-quick-actions">
          <button
            className="meeting-icon-btn success"
            title="Успешно"
            onClick={(e) => {
              e.stopPropagation();
              onQuickStatus("success");
            }}
          >
            ✅
          </button>
          <button
            className="meeting-icon-btn noresult"
            title="Без результата"
            onClick={(e) => {
              e.stopPropagation();
              onQuickStatus("no_result");
            }}
          >
            🚫
          </button>
          <button
            className="meeting-icon-btn reschedule"
            title="Перенести"
            onClick={(e) => {
              e.stopPropagation();
              onQuickReschedule();
            }}
          >
            📅
          </button>
        </div>
      )}

      <button
        className="meeting-del"
        title="Удалить встречу"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Удалить встречу «${meeting.title}»?`)) onDelete();
        }}
      >
        ×
      </button>
    </div>
  );
}
