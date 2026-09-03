"use client";

import { useState } from "react";
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
  const [showPeople, setShowPeople] = useState(false);
  const participants = sanitizeAssigneeList(meeting.participants);
  const showQuickActions = !meeting.status || meeting.status === "planned";

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
        <span className="mpeople" onMouseEnter={() => setShowPeople(true)} onMouseLeave={() => setShowPeople(false)} style={{ position: "relative" }}>
          👥 {participants.length}
          {showPeople && (
            <div className="people-tooltip" style={{ display: "block", position: "absolute", top: "100%", right: 0 }}>
              {participants.map((p) => (
                <div className="prow" key={p}>
                  {p}
                </div>
              ))}
            </div>
          )}
        </span>
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
