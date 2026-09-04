"use client";

// Port of the meeting modal from trackerMarkup.ts + openMeetingModal()/
// meetingSaveBtn/deleteMeetingBtn/setMeetingStatus/performReschedule in
// legacy-tracker.js. Kept on the same element ids for e2e-pattern reuse.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Meeting, MeetingPrefill, MeetingStatus } from "@/types/tracker";
import { addDaysIso } from "@/lib/calendarLogic";
import { fmtDate } from "@/lib/taskDisplay";
import { sanitizeAssigneeList } from "@/lib/trackerRows";
import { uid } from "@/lib/uid";

function outcomeLabel(status: MeetingStatus): string {
  if (status === "success") return "✅ Успешно завершена";
  if (status === "no_result") return "🚫 Без результата";
  return "";
}

export default function MeetingModal({
  meeting,
  prefill,
  assignees,
  onSave,
  onDelete,
  onClose,
  onSetStatus,
  onReschedule,
}: {
  meeting: Meeting | null;
  prefill?: MeetingPrefill;
  assignees: string[];
  onSave: (m: Meeting) => void;
  onDelete: () => void;
  onClose: () => void;
  onSetStatus: (meeting: Meeting, status: MeetingStatus, result: string) => void;
  onReschedule: (meeting: Meeting, newDate: string, newTime: string, resultNote: string) => void;
}) {
  const isEditing = !!meeting;
  const [date, setDate] = useState(meeting?.date ?? prefill?.date ?? "");
  const [title, setTitle] = useState(meeting?.title ?? prefill?.title ?? "");
  const [time, setTime] = useState(meeting?.time || prefill?.time || "10:00");
  const [participants, setParticipants] = useState<string[]>(sanitizeAssigneeList(meeting?.participants ?? prefill?.participants ?? []));
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [result, setResult] = useState(meeting?.result ?? "");
  const [rescheduleDate, setRescheduleDate] = useState(meeting ? addDaysIso(meeting.date, 1) : "");
  const [rescheduleTime, setRescheduleTime] = useState(meeting?.time || "10:00");

  // Esc closes the modal, same as legacy's global keydown handler.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function toggleParticipant(name: string) {
    setParticipants((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
  }

  function participantsLabel() {
    if (participants.length === 0) return "Выберите участников";
    if (participants.length <= 2) return participants.join(", ");
    return `${participants.length} участников: ${participants.slice(0, 2).join(", ")}…`;
  }

  function save() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      alert("Укажите название встречи");
      return;
    }
    if (!date) {
      alert("Укажите дату встречи");
      return;
    }
    onSave({
      id: meeting?.id ?? uid(),
      date,
      time: time || "",
      title: trimmedTitle,
      participants: sanitizeAssigneeList(participants),
      status: meeting?.status ?? "planned",
      result: meeting ? result.trim() : "",
      movedToDate: meeting?.movedToDate ?? "",
    });
    onClose();
  }

  function setStatus(status: MeetingStatus) {
    if (!meeting) return;
    onSetStatus(meeting, status, result);
    onClose();
  }

  function reschedule() {
    if (!meeting) return;
    if (!rescheduleDate) {
      alert("Укажите дату следующего этапа");
      return;
    }
    onReschedule(meeting, rescheduleDate, rescheduleTime || meeting.time || "10:00", result);
    onClose();
  }

  const resolved = isEditing && meeting.status && meeting.status !== "planned";

  return createPortal(
    <div className="overlay open" id="meetingOverlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 id="meetingModalTitle">{isEditing ? "Редактировать встречу" : "Новая встреча"}</h2>
        <input type="hidden" id="meetingId" value={meeting?.id ?? ""} readOnly />

        <div className="field">
          <label>Дата</label>
          <input type="date" id="mDate" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="field">
          <label>Название встречи</label>
          <input type="text" id="mTitle" placeholder="Например: Совещание по опту" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field">
          <label>Время</label>
          <input type="time" id="mTime" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>

        <div className="field participants-field" id="participantsField">
          <label>Состав участников</label>
          <button
            type="button"
            className={"participants-trigger" + (participantsOpen ? " open" : "")}
            id="participantsTrigger"
            onClick={() => setParticipantsOpen((v) => !v)}
          >
            {participantsLabel()}
          </button>
          <div className={"participants-dropdown" + (participantsOpen ? " open" : "")} id="participantsDropdown">
            <div className="participants-list" id="mParticipants">
              {assignees.map((name) => (
                <label className="participant-row" key={name}>
                  <input type="checkbox" value={name} checked={participants.includes(name)} onChange={() => toggleParticipant(name)} />
                  <span>{name}</span>
                </label>
              ))}
            </div>
            <div className="participants-dropdown-footer">
              <button type="button" className="btn btn-small btn-primary" id="participantsDoneBtn" onClick={() => setParticipantsOpen(false)}>
                Готово
              </button>
            </div>
          </div>
        </div>

        {isEditing && (
          <div className="field outcome-field" id="outcomeField">
            <label>Итог встречи</label>
            <div className={"outcome-badge" + (resolved ? ` show ${meeting.status}` : "")} id="outcomeBadge">
              {resolved ? outcomeLabel(meeting.status) + (meeting.movedToDate ? " · перенесено на " + fmtDate(meeting.movedToDate) : "") : ""}
            </div>
            <textarea id="mResult" rows={2} placeholder="Кратко: что решили, что дальше…" value={result} onChange={(e) => setResult(e.target.value)} />
            <div className="outcome-actions">
              <button type="button" className="btn btn-small outcome-btn-success" id="markSuccessBtn" onClick={() => setStatus("success")}>
                ✅ Успешно
              </button>
              <button type="button" className="btn btn-small outcome-btn-noresult" id="markNoResultBtn" onClick={() => setStatus("no_result")}>
                🚫 Без результата
              </button>
              {resolved && (
                <button type="button" className="btn btn-small" id="reopenMeetingBtn" onClick={() => setStatus("planned")}>
                  ↺ Вернуть в план
                </button>
              )}
            </div>
            <div className="reschedule-row">
              <input type="date" id="mRescheduleDate" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
              <input type="time" id="mRescheduleTime" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} />
              <button type="button" className="btn btn-small" id="rescheduleBtn" onClick={reschedule}>
                📅 Перенести следующий этап
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <div className="left">
            {isEditing && (
              <button
                className="btn btn-danger-ghost"
                id="deleteMeetingBtn"
                onClick={() => {
                  if (confirm("Удалить эту встречу?")) {
                    onDelete();
                    onClose();
                  }
                }}
              >
                Удалить
              </button>
            )}
          </div>
          <div className="left">
            <button className="btn" id="meetingCancelBtn" onClick={onClose}>
              Отмена
            </button>
            <button className="btn btn-primary" id="meetingSaveBtn" onClick={save}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
