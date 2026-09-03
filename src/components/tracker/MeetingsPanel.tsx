"use client";

import { useState } from "react";
import type { Meeting, MeetingStatus } from "@/types/tracker";
import { addDaysIso, sortMeetingsForList } from "@/lib/calendarLogic";
import { todayStr } from "@/lib/taskDisplay";
import { uid } from "@/lib/uid";
import MeetingChip from "./MeetingChip";
import MeetingModal from "./MeetingModal";
import type { useToasts } from "@/hooks/useToasts";
import type { useDateTimeConfirm } from "@/hooks/useDateTimeConfirm";
import PanelDragHandle, { resolveDragHandleProps, type PanelDragProps } from "./PanelDragHandle";

export default function MeetingsPanel({
  meetings,
  assignees,
  showResolved,
  selectedDay,
  actions,
  toasts,
  dateTimeConfirm,
  openMeetingRequest,
  onOpenMeetingHandled,
  onIdeaDropped,
  justCreatedId,
  dragHandleProps,
  isDragging,
  dropIndicatorBefore,
}: {
  meetings: Meeting[];
  assignees: string[];
  showResolved: boolean;
  selectedDay: string | null;
  actions: {
    saveMeeting: (m: Meeting) => void;
    deleteMeeting: (id: string) => void;
    restoreMeeting: (m: Meeting) => void;
  };
  toasts: ReturnType<typeof useToasts>;
  dateTimeConfirm: ReturnType<typeof useDateTimeConfirm>;
  // Lets a sibling (the calendar) request opening the "new meeting" modal
  // for a specific date, e.g. from the date popover's "+ Встреча" button.
  openMeetingRequest: string | null;
  onOpenMeetingHandled: () => void;
  onIdeaDropped: (ideaId: string) => void;
  justCreatedId?: string | null;
} & PanelDragProps) {
  const [ideaDragOver, setIdeaDragOver] = useState(false);
  const [modalState, setModalState] = useState<{ open: boolean; meeting: Meeting | null; presetDate?: string }>({ open: false, meeting: null });

  // See TasksPanel's identical pattern: an external open request from a
  // sibling (the calendar's date popover) is treated as an alternate open
  // source rather than synced into local state via an effect.
  const modalOpen = modalState.open || openMeetingRequest !== null;
  const modalMeeting = modalState.open ? modalState.meeting : null;
  const modalPresetDate = modalState.open ? modalState.presetDate : (openMeetingRequest ?? undefined);
  function closeModal() {
    setModalState({ open: false, meeting: null });
    if (openMeetingRequest !== null) onOpenMeetingHandled();
  }

  const sorted = sortMeetingsForList(meetings, showResolved);

  function deleteMeeting(m: Meeting) {
    actions.deleteMeeting(m.id);
    toasts.showToast("Встреча удалена", m.title, () => actions.restoreMeeting(m));
  }

  function setStatus(m: Meeting, status: MeetingStatus, resultText: string) {
    const prev = { status: m.status, result: m.result, movedToDate: m.movedToDate };
    actions.saveMeeting({ ...m, status, result: resultText.trim(), movedToDate: status === "planned" ? "" : m.movedToDate });
    toasts.showToast(status === "planned" ? "Встреча возвращена в план" : "Итог встречи сохранён", m.title, () =>
      actions.saveMeeting({ ...m, ...prev }),
    );
  }

  function reschedule(m: Meeting, newDate: string, newTime: string, resultNote: string) {
    const prev = { status: m.status, result: m.result, movedToDate: m.movedToDate };
    const followUp: Meeting = {
      id: uid(),
      date: newDate,
      time: newTime || m.time || "",
      title: m.title,
      participants: m.participants.slice(),
      status: "planned",
      result: "",
      movedToDate: "",
    };
    actions.saveMeeting(followUp);
    actions.saveMeeting({ ...m, status: "no_result", result: (resultNote || "").trim() || "Перенесено на следующий этап", movedToDate: newDate });
    toasts.showToast("Встреча перенесена", m.title, () => {
      actions.deleteMeeting(followUp.id);
      actions.saveMeeting({ ...m, ...prev });
    });
  }

  async function quickReschedule(m: Meeting) {
    const suggestedDate = addDaysIso(m.date, 1);
    const result = await dateTimeConfirm.ask(`Перенести встречу «${m.title}» на:`, suggestedDate, m.time || "10:00");
    if (!result) return;
    reschedule(m, result.date, result.time, m.result);
  }

  return (
    <div className={"panel dash-panel" + (isDragging ? " dragging" : "") + (dropIndicatorBefore ? " drag-indicator" : "")} id="meetingsPanel" data-panel-id="meetingsPanel">
      <div className="dash-panel-head">
        <PanelDragHandle {...resolveDragHandleProps(dragHandleProps)} />
        <div className="panel-title">
          Встречи <span className="count">{sorted.length}</span>
        </div>
        <button className="btn btn-primary btn-small" id="addMeetingBtn" onClick={() => setModalState({ open: true, meeting: null, presetDate: selectedDay ?? todayStr() })}>
          +
        </button>
      </div>
      <div
        id="meetingsForDay"
        className={ideaDragOver ? "drag-over" : ""}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("application/x-idea-id")) return;
          e.preventDefault();
          setIdeaDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setIdeaDragOver(false);
        }}
        onDrop={(e) => {
          const ideaId = e.dataTransfer.getData("application/x-idea-id");
          setIdeaDragOver(false);
          if (!ideaId) return;
          e.preventDefault();
          onIdeaDropped(ideaId);
        }}
      >
        {sorted.length === 0 ? (
          <div className="empty">{meetings.length === 0 ? "Встреч пока нет" : "Нет запланированных встреч"}</div>
        ) : (
          sorted.map((m) => (
            <MeetingChip
              key={m.id}
              meeting={m}
              selectedDay={selectedDay}
              onOpen={() => setModalState({ open: true, meeting: m })}
              onDelete={() => deleteMeeting(m)}
              onQuickStatus={(status) => setStatus(m, status, m.result)}
              onQuickReschedule={() => quickReschedule(m)}
              justCreated={justCreatedId === m.id}
            />
          ))
        )}
      </div>

      {modalOpen && (
        <MeetingModal
          key={modalMeeting?.id ?? "new"}
          meeting={modalMeeting}
          presetDate={modalPresetDate}
          assignees={assignees}
          onSave={actions.saveMeeting}
          onDelete={() => modalMeeting && deleteMeeting(modalMeeting)}
          onClose={closeModal}
          onSetStatus={setStatus}
          onReschedule={reschedule}
        />
      )}
    </div>
  );
}
