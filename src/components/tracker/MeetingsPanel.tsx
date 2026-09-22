"use client";

import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Meeting, MeetingPrefill, MeetingStatus } from "@/types/tracker";
import { addDaysIso, awaitsRecap, sortMeetingsForList } from "@/lib/calendarLogic";
import { fmtDate, todayStr } from "@/lib/taskDisplay";
import { uid } from "@/lib/uid";
import MeetingChip from "./MeetingChip";
import MeetingModal from "./MeetingModal";
import DoneListModal from "./DoneListModal";
import Icon from "./Icon";
import { useMeetingVotes } from "@/hooks/useMeetingVotes";
import { bumpVoteRoundIfMoved } from "@/lib/meetingRound";
import { voteTally } from "@/lib/meetingVotes";
import { isQuietHour } from "@/lib/quietHours";
import { linkTaskAndMeeting } from "@/lib/itemLink";
import type { useToasts } from "@/hooks/useToasts";
import type { useDateTimeConfirm } from "@/hooks/useDateTimeConfirm";
import { useAsk } from "@/components/Ask";
import { isMine } from "@/lib/ownership";
import { useDropHandler } from "./dnd/TrackerDnd";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function MeetingsPanel({
  myUserId = "",
  meId = "",
  meetings,
  assignees,
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
  onTaskDropped,
  justCreatedId,
}: {
  // Свой auth-id: чужую встречу видно, потому что тебя на неё позвали, но
  // это не право её закрывать, переносить и удалять — база откажет молча
  // (миграция 0019). Пусто у владельца: в его пространстве всё его.
  myUserId?: string;
  // Моя строка в списке людей: по ней во встрече находится мой голос и
  // появляются кнопки «Буду / Опоздаю / Не смогу».
  meId?: string;
  meetings: Meeting[];
  assignees: string[];
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
  // Задача, принесённая в блок встреч: открывает форму встречи, заполненную
  // по ней, и оставляет саму задачу на доске.
  onTaskDropped: (taskId: string) => void;
  justCreatedId?: string | null;
}) {
  // Голосование по встречам — один слой на всю панель, как участники у
  // задач: и карточки, и форма читают отсюда.
  const votes = useMeetingVotes();
  const ask = useAsk();
  const isMobile = useIsMobile();
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
  // Перенос УЖЕ сохранён, и окно закрывается по-настоящему.
  //
  // Ref, а не состояние, потому что читает это closeModal, вызванный формой
  // в ту же долю секунды после onSave: новое состояние к этому моменту ещё
  // не доехало, и окно вернулось бы к прежней встрече — той самой, которую
  // только что закрыли как перенесённую.
  const movedSavedRef = useRef(false);
  // Окно с прошедшими встречами.
  const [doneOpen, setDoneOpen] = useState(false);

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
    // Escape закрывает ОДИН уровень, а не всю стопку.
    //
    // Слова Кирилла 21.09.2026: «открываешь встречу → нажимаешь „перенести
    // время“ → решаешь, что не хочешь, и жмёшь „esc“ — закрываются все
    // уровни до начальной страницы, это неправильно… требовалось два раза
    // нажать esc, чтобы вернуться на главную».
    //
    // Так и выходило, и причина в том, что перенос — не второе окно поверх
    // первого, а ТО ЖЕ окно, переключённое с встречи на форму новой. Для
    // браузера уровень один, и Escape честно закрывал его целиком. Поэтому
    // уровень приходится помнить самим: форма переноса закрывается назад,
    // во встречу, из которой её открыли, и только следующий Escape (или
    // «Отмена») закрывает встречу.
    if (movingFrom && !movedSavedRef.current) {
      const back = movingFrom;
      setMovingFrom(null);
      setModalState({ open: true, meeting: back });
      return;
    }
    movedSavedRef.current = false;
    setMovingFrom(null);
    setModalState({ open: false, meeting: null });
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
    if (movingFrom) {
      // Перенос состоялся — окно после этого закрывается целиком, а не
      // возвращается к прежней встрече (см. closeModal).
      movedSavedRef.current = true;
      closeAsMoved(movingFrom, m);
    }
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

  // Мысль или задача, брошенная в блок встреч, становится встречей.
  //
  // Задача сюда бросается из ЛЮБОГО столбца доски — и из «Новых», и из «В
  // работе», и из «На приёмке». Слова Кирилла 21.09.2026: «при переносе
  // задачи во встречу встреча не создаётся… встречи должны мочь
  // создаваться и из списка новых задач, и из списка задач в работе, и из
  // списка „на приёмку“, так как я допускаю, что окончательная приёмка
  // задачи возможна только после личного разговора». До сих пор зона
  // принимала только мысль, а задачу приходилось нести на день календаря —
  // то есть путь был, но не тот, который пробуют первым: блок встреч
  // ближе, крупнее и назван словом «Встречи».
  //
  // Задача при этом НЕ исчезает. Встреча — разговор О задаче, а не замена
  // ей: после встречи к задаче возвращаются и совершают по ней итоговое
  // действие (а успешная встреча совершает его сама — см.
  // lib/meetingRecap.approveTaskFromMeeting).
  //
  // Зона — вся панель, а не только список под шапкой. Встреч может не быть
  // вовсе (у Кирилла на снимке «ВСТРЕЧИ 0»), и тогда список — это одна
  // строка «Встреч пока нет»: целиться в неё мышью значит промахиваться.
  //
  // Подсветки «вот эта зона» у панели нет — по той же причине, по которой
  // её нет у столбцов доски (см. .task.dragging в tracker.css): контуры
  // вокруг половины экрана Кирилл попросил убрать 20.09.2026, а карточка,
  // едущая под курсором над встречами, и так говорит, куда она упадёт.
  const { setNodeRef: setMeetingsDropRef } = useDroppable({ id: "meetings", data: { target: { kind: "meetings" } } });
  useDropHandler("idea", (ideaId, target) => {
    if (target.kind !== "meetings") return;
    onIdeaDropped(ideaId);
  });
  useDropHandler("task", (taskId, target) => {
    if (target.kind !== "meetings") return;
    onTaskDropped(taskId);
  });

  // Список — только то, что впереди. Закрытые и перенесённые смотрят в
  // отдельном окне по иконке с галочкой: подмешанные сюда, они превращали
  // список встреч в архив, в котором ближайшая теряется.
  const all = sortMeetingsForList(meetings, false);
  // Прошедшие без итога — наверх и отдельно. Это единственные встречи в
  // списке, которые чего-то ждут ОТ ВАС: остальные просто впереди.
  const needRecap = all.filter((m) => awaitsRecap(m));
  const sorted = all.filter((m) => !awaitsRecap(m));
  const resolved = sortMeetingsForList(meetings, true).filter((m) => m.status && m.status !== "planned" && m.status !== "proposed");

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
    //
    // Уходит теперь при ЛЮБОМ разрешённом исходе, а не только когда итог
    // написан словами, и несёт `outcome`. Причина — правило «успешная
    // встреча принимает свою задачу»: чем кончилась встреча, знает только
    // вкладка (статус — колонка движка синхронизации, маршруту она не
    // видна), а задача из «На приёмке» должна закрыться и тогда, когда
    // итог оставили пустым.
    //
    // Проверяются именно два исхода, а не «всё, кроме planned»: у статуса
    // есть и «предложена», и её рассылать итогом нечем.
    if (status === "success" || status === "no_result") {
      void fetch("/api/workspace/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: m.id, result: resultText.trim(), outcome: status }),
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
      // Перенос сохраняет длительность: переносят ВСТРЕЧУ, а не только её
      // начало, и часовая планёрка не должна стать получасовой оттого,
      // что её сдвинули на день.
      durationMin: m.durationMin || 30,
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
    <div className="panel dash-panel" id="meetingsPanel" data-panel-id="meetingsPanel" ref={setMeetingsDropRef}>
      {/* На телефоне этой строки нет вовсе.
          Слова Кирилла 20.09.2026: «убрать полоску с „встречи“, количество
          встреч и кнопкой для создания новой, это всё лишнее, так как итак
          понятно, что мы в блоке встречи». Каждая из трёх вещей в ней уже
          сказана в другом месте: название — подписью вкладки внизу, число —
          цифрой на той же вкладке, «+» — круглой кнопкой, которая на
          телефоне и так заводит встречу именно здесь (см. NewTracker).
          Прошедшие встречи с телефона не показываются по его же слову
          («завершённые в мобильной версии поскрывай»): это чтение задним
          числом, и место ему на компьютере. */}
      {!isMobile && (
        <div className="dash-panel-head">
          <div className="panel-title">
            Встречи <span className="count">{sorted.length + needRecap.length}</span>
          </div>
          {/* Иконка завершённых — рядом с «+», а не переключателем в
              шапке трекера: это вопрос к ЭТОЙ панели, и отвечать на него
              должна она. */}
          {resolved.length > 0 && (
            <button
              type="button"
              className="panel-done-btn"
              id="meetingsDoneBtn"
              title="Прошедшие и отменённые встречи"
              onClick={() => setDoneOpen(true)}
            >
              <Icon name="check" size={14} />
              <span className="panel-done-count">{resolved.length}</span>
            </button>
          )}
          <button className="btn btn-primary btn-small" id="addMeetingBtn" title="Новая встреча (B)" onClick={() => setModalState({ open: true, meeting: null, prefill: { date: selectedDay ?? todayStr() } })}>
            +
          </button>
        </div>
      )}
      {/* Что прошло и не закрыто — первым: пока итога нет, встреча не
          закончилась, чем бы она ни закончилась на самом деле. */}
      {needRecap.length > 0 && (
        <div className="meetings-need-recap">
          <div className="meetings-group-title">Нужен итог</div>
          {needRecap.map((m) => (
            <MeetingChip
              key={m.id}
              meeting={m}
              selectedDay={selectedDay}
              onOpen={() => setModalState({ open: true, meeting: m })}
              onDelete={() => deleteMeeting(m)}
              onQuickStatus={(status) => void quickStatus(m, status)}
              onQuickReschedule={() => quickReschedule(m)}
              votes={voteTally(votes.forMeeting(m.id), m.voteRound || 1)}
              canManage={isMine(m, myUserId)}
            />
          ))}
        </div>
      )}

      <div id="meetingsForDay">
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
              canManage={isMine(m, myUserId)}
              justCreated={justCreatedId === m.id}
            />
          ))
        )}
      </div>

      {doneOpen && (
        <DoneListModal
          title="Прошедшие встречи"
          empty="Прошедших встреч пока нет."
          restoreLabel="В план"
          items={resolved.map((m) => ({
            id: m.id,
            title: m.title,
            when: fmtDate(m.date) + (m.time ? ", " + m.time : ""),
            note: m.status === "success" ? m.result || "прошла" : m.status === "no_result" ? "без результата" : m.movedToDate ? "перенесена на " + fmtDate(m.movedToDate) : "",
            onOpen: () => setModalState({ open: true, meeting: m }),
            onRestore: isMine(m, myUserId) ? () => setStatus(m, "planned", m.result) : undefined,
          }))}
          onClose={() => setDoneOpen(false)}
        />
      )}

      {modalOpen && (
        <MeetingModal
          // key меняется вместе с тем, что показывает форма. При переносе
          // она превращается из открытой встречи в новую, и без этого React
          // оставил бы прежнее состояние полей — то есть состав и время
          // старой встречи вместо предзаполненных.
          key={modalMeeting?.id ?? (movingFrom ? "move-" + movingFrom.id : "new")}
          meeting={modalMeeting}
          // Чем заняты люди в этот день — считается из тех же встреч, что
          // панель уже держит: ни одного лишнего запроса, а ответ на «кто
          // свободен в 12:00» появляется прямо под сеткой времени.
          dayMeetings={meetings}
          // Своя встреча — та, которую собрал сам. Чужую видно, потому что
          // позвали; закрывать, переносить и удалять её вправе организатор.
          canEdit={isMine(modalMeeting, myUserId)}
          canConfirm={isMine(modalMeeting, myUserId)}
          // Моя строка голосования: по ней в карточке появляются «Буду /
          // Опоздаю / Не смогу». Раньше они были только на отдельном экране.
          myVote={modalMeeting ? votes.forMeeting(modalMeeting.id).find((v) => v.assigneeId === meId) || null : null}
          // Ответы всех, кого позвали: в сводке встречи они стоят прямо у
          // имён. Панель их и так держит — лишнего запроса не появляется.
          votes={modalMeeting ? votes.forMeeting(modalMeeting.id) : []}
          onAnswer={(response, reason) =>
            modalMeeting
              ? votes.answer(
                  votes.forMeeting(modalMeeting.id).find((v) => v.assigneeId === meId)?.id || "",
                  response,
                  reason,
                )
              : Promise.resolve()
          }
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
