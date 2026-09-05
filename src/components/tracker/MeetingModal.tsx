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
import { openPickerOnClick } from "@/lib/pickerInput";
import MicButton from "./MicButton";

// 09:00–18:00 in half-hour steps: the working day, one tap per slot.
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let m = 9 * 60; m <= 18 * 60; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
})();

// The account owner is the one scheduling, so he is not offered as someone
// to add — see the participant grid.
const SELF_ASSIGNEE = "Кирилл (я)";

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

  const selectableAssignees = assignees.filter((a) => a !== SELF_ASSIGNEE);

  function toggleParticipant(name: string) {
    setParticipants((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
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
      resolvedAt: meeting?.resolvedAt ?? "",
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
          {/* Sized to the date itself rather than stretched across the modal,
              and clicking anywhere in the field opens the picker — not just
              the little calendar glyph. showPicker() is Chromium/Safari; on
              browsers without it the field still works as a normal input. */}
          <input
            type="date"
            id="mDate"
            className="date-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onClick={openPickerOnClick}
          />
        </div>

        <div className="field">
          <label>Название встречи</label>
          <div className="input-with-mic">
            <input type="text" id="mTitle" placeholder="Например: Совещание по опту" value={title} onChange={(e) => setTitle(e.target.value)} />
            <MicButton value={title} onChange={setTitle} title="Надиктовать название" />
          </div>
        </div>

        <div className="field">
          <label>Время</label>
          {/* One tap on the usual working-hours slots (09:00–18:00, every 30
              minutes). Anything outside that range is still reachable through
              the small input underneath, and shows up as its own selected
              chip so an existing 20:15 meeting isn't silently rewritten. */}
          <div className="time-grid" id="mTimeGrid">
            {TIME_SLOTS.map((slot) => (
              <button
                key={slot}
                type="button"
                className={"time-slot" + (time === slot ? " selected" : "")}
                onClick={() => setTime(slot)}
              >
                {slot}
              </button>
            ))}
            {time && !TIME_SLOTS.includes(time) && (
              <button type="button" className="time-slot selected" onClick={() => setTime(time)}>
                {time}
              </button>
            )}
          </div>
          <div className="time-other">
            <span>другое время</span>
            <input type="time" id="mTime" className="time-input" value={time} onChange={(e) => setTime(e.target.value)} onClick={openPickerOnClick} />
          </div>
        </div>

        <div className="field participants-field" id="participantsField">
          <label>Состав участников</label>
          {/* Тap-to-toggle chips instead of a dropdown of checkboxes — the
              whole team fits in a few rows. Кирилл himself is left out on
              purpose (he runs the meetings, so he is never the one being
              picked); if he is already listed on an existing meeting that
              stays untouched — see save(). */}
          <div className="participant-grid" id="mParticipants">
            {selectableAssignees.map((name) => (
              <button
                key={name}
                type="button"
                className={"participant-chip" + (participants.includes(name) ? " selected" : "")}
                onClick={() => toggleParticipant(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {isEditing && (
          <div className="field outcome-field" id="outcomeField">
            <label>Итог встречи</label>
            <div className={"outcome-badge" + (resolved ? ` show ${meeting.status}` : "")} id="outcomeBadge">
              {resolved ? outcomeLabel(meeting.status) + (meeting.movedToDate ? " · перенесено на " + fmtDate(meeting.movedToDate) : "") : ""}
            </div>
            <div className="input-with-mic">
              <textarea id="mResult" rows={2} placeholder="Кратко: что решили, что дальше…" value={result} onChange={(e) => setResult(e.target.value)} />
              <MicButton value={result} onChange={setResult} title="Надиктовать итог" />
            </div>
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
              <input type="date" id="mRescheduleDate" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} onClick={openPickerOnClick} />
              <input type="time" id="mRescheduleTime" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} onClick={openPickerOnClick} />
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
