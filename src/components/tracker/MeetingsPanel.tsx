"use client";

import { useState } from "react";
import type { Meeting, MeetingPrefill, MeetingStatus } from "@/types/tracker";
import { addDaysIso, sortMeetingsForList } from "@/lib/calendarLogic";
import { todayStr } from "@/lib/taskDisplay";
import { uid } from "@/lib/uid";
import MeetingChip from "./MeetingChip";
import MeetingModal from "./MeetingModal";
import { useMeetingVotes } from "@/hooks/useMeetingVotes";
import { bumpVoteRoundIfMoved } from "@/lib/meetingRound";
import { voteTally } from "@/lib/meetingVotes";
import { isQuietHour } from "@/lib/quietHours";
import { linkTaskAndMeeting } from "@/lib/itemLink";
import type { useToasts } from "@/hooks/useToasts";
import type { useDateTimeConfirm } from "@/hooks/useDateTimeConfirm";
import PanelDragHandle, { resolveDragHandleProps, type PanelDragProps } from "./PanelDragHandle";
import { useAsk } from "@/components/Ask";

export default function MeetingsPanel({
  myUserId = "",
  meetings,
  assignees,
  showResolved,
  selectedDay,
  actions,
  toasts,
  dateTimeConfirm,
  openMeetingRequest,
  openExistingMeetingId,
  onOpenExistingHandled,
  onOpenMeetingHandled,
  onRequestedMeetingSaved,
  onIdeaDropped,
  justCreatedId,
  dragHandleProps,
  isDragging,
  dropIndicatorBefore,
}: {
  // Свой auth-id: чужую встречу видно, потому что тебя на неё позвали, но
  // это не право её закрывать, переносить и удалять — база откажет молча
  // (миграция 0019). Пусто у владельца: в его пространстве всё его.
  myUserId?: string;
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
  openMeetingRequest: MeetingPrefill | null;
  // The global search asking for this meeting's card to be opened.
  openExistingMeetingId?: string | null;
  onOpenExistingHandled?: () => void;
  onOpenMeetingHandled: () => void;
  // Fires only for a meeting saved from such a request, so the parent can
  // finish whatever started it — e.g. an idea dragged onto a calendar day
  // is only consumed once its meeting actually exists.
  onRequestedMeetingSaved?: (meeting: Meeting) => void;
  onIdeaDropped: (ideaId: string) => void;
  justCreatedId?: string | null;
} & PanelDragProps) {
  // Голосование по встречам — один слой на всю панель, как участники у
  // задач: и карточки, и форма читают отсюда.
  const votes = useMeetingVotes();
  const [ideaDragOver, setIdeaDragOver] = useState(false);
  const ask = useAsk();
  const [modalState, setModalState] = useState<{ open: boolean; meeting: Meeting | null; prefill?: MeetingPrefill }>({ open: false, meeting: null });
  // Перенос, начатый из формы встречи: та встреча, которую надо закрыть как
  // перенесённую, когда новая будет сохранена.
  //
  // Почему через форму, а не сразу, как кнопка ⇢ в списке: у назначенной
  // встречи ни время, ни состав больше не редактируются (см. MeetingModal),
  // и перенос остался единственным местом, где их задают. Значит он и
  // должен спрашивать их полностью — формой, а не окном «дата и время».
  // Быстрый ⇢ в списке при этом никуда не делся: там переносят, ничего не
  // меняя, и два шага вместо одного были бы там потерей.
  const [movingFrom, setMovingFrom] = useState<Meeting | null>(null);

  // See TasksPanel's identical pattern: an external open request from a
  // sibling (the calendar's date popover) is treated as an alternate open
  // source rather than synced into local state via an effect.
  // The card the global search asked for, worked out during render rather
  // than pushed into state by an effect — same shape as openMeetingRequest.
  const requestedMeeting = openExistingMeetingId ? (meetings.find((m) => m.id === openExistingMeetingId) ?? null) : null;

  const modalOpen = modalState.open || openMeetingRequest !== null || requestedMeeting !== null;
  const modalMeeting = modalState.open ? modalState.meeting : requestedMeeting;
  const modalPrefill = modalState.open ? modalState.prefill : (openMeetingRequest ?? undefined);
  function closeModal() {
    setModalState({ open: false, meeting: null });
    // Закрыли форму, не сохранив — переноса не было, и старая встреча
    // остаётся в плане нетронутой.
    setMovingFrom(null);
    if (openMeetingRequest !== null) onOpenMeetingHandled();
    if (openExistingMeetingId) onOpenExistingHandled?.();
  }
  function handleModalSave(m: Meeting) {
    const before = modalMeeting;
    actions.saveMeeting(m);
    // Новая встреча сохранена — значит перенос состоялся: старую закрываем
    // тем же способом, что и быстрый ⇢, включая отмену. Порядок важен:
    // сначала новая должна попасть в состояние, иначе отмена восстановит
    // старую в мир, где следующей ещё нет.
    if (movingFrom) closeAsMoved(movingFrom, m);
    // Строки голосования держатся за списком участников, а не редактируются
    // рядом с ним: два списка одних и тех же людей расходятся за неделю.
    void votes.sync(m.id, m.participants).then((added) => {
      // Позвать тех, кого только что добавили. «Встреча» — из того
      // минимума уведомлений, который нельзя отключить: человек, которого
      // ждут и не позвали, не придёт, и виноват будет трекер. Ночью
      // молчим — встреча всё равно попадёт в утреннюю сводку.
      if (!added.length || isQuietHour()) return;
      void fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "meeting", id: m.id, to: added }),
      }).catch(() => {});
    });
    if (before) void bumpVoteRoundIfMoved(m.id, before, m);

    // Встреча, выросшая из задачи: отметка в обсуждении обеих. Строка в
    // переписке, а не колонка в базе, — потому что читать это будет
    // человек, а не запрос, и видно её там же, где всё остальное по делу.
    const from = !before ? modalPrefill?.fromTaskId : undefined;
    if (from) {
      const when = `${m.date.split("-").reverse().join(".")}${m.time ? ", " + m.time : ""}`;
      void linkTaskAndMeeting(from, modalPrefill?.fromTaskTitle || "", m.id, m.title, when);
    }
    // Runs before closeModal() (the modal saves, then closes), so the
    // request is still open here and this only fires for requested opens.
    if (!modalState.open && openMeetingRequest !== null) onRequestedMeetingSaved?.(m);
  }

  const sorted = sortMeetingsForList(meetings, showResolved);

  function deleteMeeting(m: Meeting) {
    actions.deleteMeeting(m.id);
    toasts.showToast("Встреча удалена", m.title, () => actions.restoreMeeting(m));
  }

  function setStatus(m: Meeting, status: MeetingStatus, resultText: string) {
    const prev = { status: m.status, result: m.result, movedToDate: m.movedToDate, resolvedAt: m.resolvedAt };
    actions.saveMeeting({
      ...m,
      status,
      result: resultText.trim(),
      movedToDate: status === "planned" ? "" : m.movedToDate,
      // Orders the resolved half of the list newest-first; cleared when the
      // meeting goes back into the plan.
      resolvedAt: status === "planned" ? "" : new Date().toISOString(),
    });
    // Итог уходит тем, кто был: до сих пор его не получал никто, кроме
    // самого Кирилла, — а «о чём договорились» и есть то единственное, ради
    // чего половина участников на встречу шла. Не дошло — встреча всё равно
    // закрыта: рассылка не должна ронять сохранение.
    if (status !== "planned" && resultText.trim()) {
      void fetch("/api/workspace/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: m.id, result: resultText.trim() }),
      }).catch(() => {});
    }
    toasts.showToast(status === "planned" ? "Встреча возвращена в план" : "Итог встречи сохранён и отправлен участникам", m.title, () =>
      actions.saveMeeting({ ...m, ...prev }),
    );
  }

  // Закрыть встречу кнопкой прямо в списке — и сразу сказать, чем она
  // кончилась.
  //
  // Раньше ✓ и ✕ на карточке закрывали встречу молча, с тем итогом, который
  // был записан (то есть обычно с пустым), и назавтра «Совещание по опту»
  // отличалось от «Совещания по опту» только галочкой. Итог — единственное,
  // что от встречи остаётся: его спрашивает утренняя сводка, его читают в
  // обсуждении, и он же отвечает на «а чем в прошлый раз кончили». Поэтому
  // окно, а не тишина. Пустым оставить можно: бывают встречи, которые просто
  // прошли, и заставлять выдумывать слова ради формы — худший способ
  // получить осмысленный итог.
  async function quickStatus(m: Meeting, status: "success" | "no_result") {
    const text = await ask.ask({
      title: status === "success" ? "Встреча прошла успешно" : "Встреча без результата",
      question: "Итог встречи",
      note:
        status === "success"
          ? "Кратко: что решили, что дальше. Это увидят участники и утренняя сводка."
          : "Кратко: почему не вышло и что теперь. Без этого встреча выглядит просто отменённой.",
      value: m.result || "",
      multiline: true,
      placeholder: "Например: договорились по срокам, Игорь готовит смету к пятнице",
      okText: status === "success" ? "Завершить успешно" : "Закрыть без результата",
    });
    // Отмена — это отмена: встреча остаётся в плане.
    if (text === null) return;
    setStatus(m, status, text);
  }

  // Закрыть встречу как перенесённую на другую, уже созданную.
  //
  // Одна функция на оба пути — быстрый ⇢ в списке и перенос из формы, — иначе
  // они разойдутся: «перенесено» это не одна пометка, а четыре поля разом
  // плюс отмена, которая должна вернуть ровно то, что было.
  function closeAsMoved(m: Meeting, followUp: Meeting, resultNote?: string) {
    const prev = { status: m.status, result: m.result, movedToDate: m.movedToDate, resolvedAt: m.resolvedAt };
    actions.saveMeeting({
      ...m,
      status: "no_result",
      result: (resultNote ?? m.result ?? "").trim() || "Перенесено на следующий этап",
      movedToDate: followUp.date,
      resolvedAt: new Date().toISOString(),
    });
    toasts.showToast("Встреча перенесена", m.title, () => {
      actions.deleteMeeting(followUp.id);
      actions.saveMeeting({ ...m, ...prev });
    });
  }

  function reschedule(m: Meeting, newDate: string, newTime: string, resultNote: string) {
    const followUp: Meeting = {
      id: uid(),
      date: newDate,
      time: newTime || m.time || "",
      title: m.title,
      participants: m.participants.slice(),
      status: "planned",
      result: "",
      movedToDate: "",
      resolvedAt: "",
    };
    actions.saveMeeting(followUp);
    closeAsMoved(m, followUp, resultNote);
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
        <button className="btn btn-primary btn-small" id="addMeetingBtn" title="Новая встреча (B)" onClick={() => setModalState({ open: true, meeting: null, prefill: { date: selectedDay ?? todayStr() } })}>
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
              onQuickStatus={(status) => void quickStatus(m, status)}
              onQuickReschedule={() => quickReschedule(m)}
              votes={voteTally(votes.forMeeting(m.id), m.voteRound || 1)}
              justCreated={justCreatedId === m.id}
            />
          ))
        )}
      </div>

      {modalOpen && (
        <MeetingModal
          // key меняется вместе с тем, что показывает форма. При переносе
          // она превращается из открытой встречи в новую, и без этого React
          // оставил бы прежнее состояние полей — то есть состав и время
          // старой встречи вместо предзаполненных.
          key={modalMeeting?.id ?? (movingFrom ? "move-" + movingFrom.id : "new")}
          meeting={modalMeeting}
          // Своя встреча — та, которую собрал сам. Чужую видно, потому что
          // позвали; закрывать, переносить и удалять её вправе организатор.
          canEdit={!myUserId || !modalMeeting || (modalMeeting.createdBy || "") === myUserId}
          prefill={modalPrefill}
          assignees={assignees}
          onSave={handleModalSave}
          onDelete={() => modalMeeting && deleteMeeting(modalMeeting)}
          onClose={closeModal}
          onSetStatus={setStatus}
          isMove={!!movingFrom && !modalMeeting}
          onReschedule={
            modalMeeting
              ? () => {
                  const from = modalMeeting;
                  setMovingFrom(from);
                  // Форма новой встречи, предзаполненная прежней: по
                  // умолчанию тот же день + 1 и то же время — перенос без
                  // правок остаётся парой нажатий, а поправить время или
                  // состав можно здесь же.
                  setModalState({
                    open: true,
                    meeting: null,
                    prefill: {
                      title: from.title,
                      date: addDaysIso(from.date, 1),
                      time: from.time || "",
                      participants: from.participants.slice(),
                    },
                  });
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
