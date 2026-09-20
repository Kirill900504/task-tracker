"use client";

// Port of the meeting modal from trackerMarkup.ts + openMeetingModal()/
// meetingSaveBtn/deleteMeetingBtn/setMeetingStatus/performReschedule in
// legacy-tracker.js. Kept on the same element ids for e2e-pattern reuse.
import { useState } from "react";
import { useColleagues } from "@/hooks/useColleagues";
import SendMenu from "./SendMenu";
import ItemChat from "./ItemChat";
import MeetingAnswer from "./MeetingAnswer";
import type { MeetingVoteRow } from "@/hooks/useMeetingVotes";
import type { Meeting, MeetingPrefill, MeetingStatus } from "@/types/tracker";
import { fmtDate } from "@/lib/taskDisplay";
import { isSelfAssignee, sanitizeAssigneeList } from "@/lib/trackerRows";
import { uid } from "@/lib/uid";
import MicButton from "./MicButton";
import MiniCalendar from "./MiniCalendar";
import AutoGrowTextarea from "./AutoGrowTextarea";
import { useAsk } from "@/components/Ask";
import { sortNames } from "@/lib/peopleOrder";
import Modal from "./Modal";
import Icon from "./Icon";
import ChipChoice from "./ChipChoice";

// 09:00–18:00 in half-hour steps: the working day, one tap per slot.
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let m = 9 * 60; m <= 18 * 60; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
})();

function outcomeLabel(status: MeetingStatus): string {
  if (status === "proposed") return "Предложена";
  // Без эмодзи: метка уже покрашена в свой цвет и обведена им же
  // (.outcome-badge), и наклейка поверх этого ничего не добавляет.
  if (status === "success") return "Успешно завершена";
  if (status === "no_result") return "Без результата";
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
  canEdit = true,
  canConfirm = false,
  isMove,
  myVote = null,
  onAnswer,
}: {
  meeting: Meeting | null;
  prefill?: MeetingPrefill;
  assignees: string[];
  onSave: (m: Meeting) => void;
  onDelete: () => void;
  onClose: () => void;
  onSetStatus: (meeting: Meeting, status: MeetingStatus, result: string) => void;
  // Единственный путь изменить «когда» и «кого» у назначенной встречи.
  // Открывает форму НОВОЙ встречи с тем же составом; старая закроется как
  // перенесённая, когда новая будет сохранена (см. MeetingsPanel).
  onReschedule?: () => void;
  // Чужая встреча: её видно, потому что позвали, но закрывать, переносить
  // и удалять её вправе организатор. База откажет всё равно — и откажет
  // молча, поэтому кнопок здесь просто нет.
  canEdit?: boolean;
  // Может назначить предложенное: тот, кто встречу собрал.
  canConfirm?: boolean;
  // Эта новая встреча — перенос прежней. Форма та же, что у любой новой, но
  // называться «Новая встреча» она не должна: человек нажал «Перенести», и
  // заголовок обязан подтвердить, что происходит именно это, — иначе
  // выглядит так, будто нажатие завело вторую встречу вдобавок к первой.
  isMove?: boolean;
  // Моя строка голосования по этой встрече, если меня позвали. Пусто —
  // встреча меня не касается, и отвечать не на что.
  myVote?: MeetingVoteRow | null;
  onAnswer?: (response: "yes" | "no" | "late", reason: string) => Promise<void>;
}) {
  const isEditing = !!meeting;
  const [date, setDate] = useState(meeting?.date ?? prefill?.date ?? "");
  const [title, setTitle] = useState(meeting?.title ?? prefill?.title ?? "");
  const [time, setTime] = useState(meeting?.time || prefill?.time || "10:00");
  const [participants, setParticipants] = useState<string[]>(sanitizeAssigneeList(meeting?.participants ?? prefill?.participants ?? []));
  const { colleagues } = useColleagues();
  const ask = useAsk();
  const [sendState, setSendState] = useState("");
  const [sendAt, setSendAt] = useState<DOMRect | null>(null);
  const [result, setResult] = useState(meeting?.result ?? "");
  // Назначаем сразу или сперва спрашиваем.
  //
  // Раньше это решал не человек, а его место в системе: у владельца
  // встреча становилась назначенной, у руководителя — всегда только
  // предложением, и выйти из предложения он не мог ничем. Вопрос
  // Кирилла 20.09.2026 был именно об этом: «а если Макаров хочет
  // организовать встречу с Есиной и Мамаковой? он что не может
  // назначить?». Может. Но выбор остаётся — он и есть разница между
  // «в 15:00 у нас планёрка» и «давайте в 15:00, кто может?».
  const [asProposal, setAsProposal] = useState(false);

  // Esc закрывает окно — как и любое другое окно трекера.

  // The account owner is the one scheduling, so he is not offered as
  // someone to add to his own meeting.
  const selectableAssignees = sortNames(assignees.filter((a) => !isSelfAssignee(a)));

  function toggleParticipant(name: string) {
    setParticipants((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
  }

  // Same as the task modal: offered whenever anyone is connected, not only
  // when a participant is — a meeting is often worth showing to someone who
  // is not in it (see SendMenu, which puts the participants first anyway).
  const linkedNames = colleagues.filter((c) => c.linked).map((c) => c.name);
  const canSend = isEditing && linkedNames.length > 0;

  function save() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      void ask.say({ title: "Название не заполнено", question: "Укажите название встречи." });
      return;
    }
    if (!date) {
      void ask.say({ title: "Дата не заполнена", question: "Укажите дату встречи." });
      return;
    }
    onSave({
      id: meeting?.id ?? uid(),
      // У назначенной встречи «когда», «что» и «кто» берутся из неё самой,
      // а не из состояния формы. Полей для них в этом режиме нет вовсе, и
      // состояние просто повторяет исходное — но брать его отсюда значило
      // бы, что достаточно одной будущей кнопки, меняющей `time`, чтобы
      // запрет перестал существовать молча. Меняется это переносом.
      date: isEditing ? meeting.date : date,
      time: isEditing ? meeting.time : time || "",
      title: isEditing ? meeting.title : trimmedTitle,
      participants: isEditing ? meeting.participants : sanitizeAssigneeList(participants),
      // Назначена или предложена — как выбрал тот, кто собирает. Раньше
      // это зависело от того, кто он: владелец назначал, руководитель мог
      // только предложить и не мог назначить никогда. Право занимать чужое
      // время у участников одинаковое, а отказаться может каждый.
      status: meeting?.status ?? (asProposal ? "proposed" : "planned"),
      result: meeting ? result.trim() : "",
      movedToDate: meeting?.movedToDate ?? "",
      resolvedAt: meeting?.resolvedAt ?? "",
      // Задача, ради которой собрались. Ставится один раз, при создании:
      // встреча вырастает из задачи, а не переприсваивается ей потом.
      // Ради этой колонки и была миграция 0037 — итог встречи должен
      // дописаться в ту самую задачу, а не в найденную по тексту реплики.
      fromTaskId: meeting?.fromTaskId ?? prefill?.fromTaskId ?? "",
    });
    onClose();
  }

  function setStatus(status: MeetingStatus) {
    if (!meeting) return;
    onSetStatus(meeting, status, result);
    onClose();
  }

  const resolved = isEditing && meeting.status && meeting.status !== "planned" && meeting.status !== "proposed";
  const proposed = isEditing && meeting.status === "proposed";

  return (
    <Modal id="meetingOverlay" onClose={onClose} dismissOnBackdrop={false}>
      <div className="modal">
        <h2 id="meetingModalTitle">{isEditing ? "Встреча" : isMove ? "Перенос встречи" : "Новая встреча"}</h2>
        {isMove && (
          <p className="field-hint meeting-move-hint">
            Прежняя встреча закроется как перенесённая, когда вы сохраните эту. Время и состав можно поправить здесь.
          </p>
        )}
        <input type="hidden" id="meetingId" value={meeting?.id ?? ""} readOnly />

        {/* Назначенная встреча — это уже состоявшаяся договорённость, а не
            черновик.
            Кирилл сказал прямо: название менять нельзя, а состав и время
            «в моменте не подлежат изменению» — «изменения и дополнения
            участниками возможны только при дальнейшем переносе». Он прав, и
            дело не в аккуратности: о встрече УЖЕ сообщили всем, кого она
            касается (MeetingsPanel зовёт их при сохранении), участники по
            ней УЖЕ проголосовали, и тихая правка времени у себя в окне не
            меняет ни того, ни другого — она только разводит то, что люди
            видели у себя, и то, что написано в трекере. Поэтому «когда» и
            «кто» здесь — факт, который читают, а меняются они переносом:
            перенос заводит НОВУЮ встречу, которую снова рассылают и снова
            голосуют, и вот в ней и время, и состав открыты. */}
        {/* Первым — то, чего ждут от вас: ответить «буду» или «не смогу».
            Ниже — всё остальное, что о встрече известно. */}
        {isEditing && myVote && onAnswer && !resolved && <MeetingAnswer me={myVote} onAnswer={onAnswer} />}

        {isEditing ? (
          <div className="field meeting-facts">
            <label>Встреча</label>
            <div className="meeting-fact-title">{title}</div>
            <div className="meeting-fact-row">
              <Icon name="calendar" size={14} />
              <span>
                {fmtDate(date)}
                {time ? `, ${time}` : ""}
              </span>
            </div>
            <div className="meeting-fact-row">
              <Icon name="users" size={14} />
              <span>{participants.length ? participants.join(", ") : "никого не позвали"}</span>
            </div>
            {/* Путь к изменению — здесь же, а не «где-то в списке». Кнопка
                открывает форму новой встречи с тем же составом: перенести и
                заодно поправить, кого зовём, — одно действие. */}
            {onReschedule && !resolved && (
              <button type="button" className="btn btn-small meeting-move-btn" id="meetingMoveBtn" onClick={onReschedule}>
                <Icon name="calendar" size={15} /> Перенести — и поправить время или состав
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="field">
              <label>Дата</label>
              {/* Сразу календарём, а не полем «дд.мм.гггг»: встречу назначают на
                  день недели («в четверг»), а не на число, и сетка месяца
                  отвечает на этот вопрос сама. */}
              <MiniCalendar popover id="mDate" value={date} onChange={setDate} />
            </div>

            <div className="field">
              <label>Название встречи</label>
              <div className="input-with-mic">
                <AutoGrowTextarea id="mTitle" placeholder="Например: Совещание по опту" value={title} onChange={setTitle} singleLine />
                <MicButton value={title} onChange={setTitle} title="Надиктовать название" />
              </div>
            </div>

            <div className="field">
              <label>Время</label>
              {/* Рабочий день кнопками, 09:00–18:00 через полчаса — одно нажатие.
                  Поля «другое время» под ними больше нет: Кирилл сказал, что оно
                  неактуально, и за всё время им ставили разве что промах мимо
                  кнопки. Встреча, назначенная когда-то на 20:15, свою кнопку
                  сохраняет — время в ней не переписывается молча. */}
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

            {/* Назначаю или предлагаю — выбор того, кто собирает, а не его
                звания. «Назначаю» — обычный случай: время стоит у всех в
                календаре, напоминания идут, ответы «буду / не смогу»
                собираются как обычно. «Предлагаю» — когда за время не
                ручаешься: оно ничьего дня не занимает, а как только все
                ответят «буду», встреча назначается сама и всем об этом
                говорят (lib/meetingConfirm). */}
            <div className="field">
              <label>Как собираем</label>
              <ChipChoice
                id="mKind"
                value={asProposal ? "proposal" : "planned"}
                onSelect={(v) => setAsProposal(v === "proposal")}
                options={[
                  { value: "planned", label: "Назначаю" },
                  { value: "proposal", label: "Предлагаю время" },
                ]}
              />
              <div className="field-hint">
                {asProposal
                  ? "Время ни у кого не занимается. Когда все ответят «буду» — встреча назначится сама."
                  : "Встреча встанет в календарь у всех, кого зовёте, и по ней пойдут напоминания."}
              </div>
            </div>
          </>
        )}

        {/* Предложенную встречу назначает тот, кто её собрал: право
            занимать чужое время у него ровно такое же, как у всех. До
            этого она видна, по ней можно ответить, но ни в календарь, ни в
            напоминания она не попадает. */}
        {proposed && canConfirm && (
          <div className="field proposed-row">
            <div className="proposed-text">
              Пока это предложение: время ни у кого не занято и напоминаний нет. Когда ответят все, встреча назначится
              сама — или назначьте сейчас, не дожидаясь.
            </div>
            <button type="button" className="btn btn-small btn-primary" id="confirmMeetingBtn" onClick={() => setStatus("planned")}>
              <Icon name="check" size={15} /> Назначить
            </button>
          </div>
        )}
        {proposed && !canConfirm && (
          <div className="field proposed-row">
            <div className="proposed-text">
              {/* Ни имени, ни должности: эту строку читают четырнадцать
                  человек, и ответ на «когда же она станет встречей»
                  зависит теперь от них самих, а не от того, кто главный. */}
              Это предложение: время оно пока не занимает. Ответьте — когда ответят все, встреча назначится.
            </div>
          </div>
        )}

        {isEditing && canEdit && (
          <div className="field outcome-field" id="outcomeField">
            <label>Итог встречи</label>
            <div className={"outcome-badge" + (resolved ? ` show ${meeting.status}` : "")} id="outcomeBadge">
              {resolved ? outcomeLabel(meeting.status) + (meeting.movedToDate ? " · перенесено на " + fmtDate(meeting.movedToDate) : "") : ""}
            </div>
            <div className="input-with-mic">
              <AutoGrowTextarea id="mResult" minRows={2} placeholder="Кратко: что решили, что дальше…" value={result} onChange={setResult} />
              <MicButton value={result} onChange={setResult} title="Надиктовать итог" />
            </div>
            <div className="outcome-actions">
              <button type="button" className="btn btn-small outcome-btn-success" id="markSuccessBtn" onClick={() => setStatus("success")}>
                <Icon name="check" size={15} /> Успешно
              </button>
              <button type="button" className="btn btn-small outcome-btn-noresult" id="markNoResultBtn" onClick={() => setStatus("no_result")}>
                <Icon name="ban" size={15} /> Без результата
              </button>
              {resolved && (
                <button type="button" className="btn btn-small" id="reopenMeetingBtn" onClick={() => setStatus("planned")}>
                  <Icon name="reset" size={15} /> Вернуть в план
                </button>
              )}
            </div>
            {/* Блока «Перенести следующий этап» здесь больше нет.
                Он занимал полкарточки — календарь, ряд часов и кнопка —
                ради действия, которое делают одним нажатием в списке: у
                встречи есть кнопка ⇢, и она спрашивает дату и время тем же
                окном (useDateTimeConfirm). Второй способ сделать то же самое,
                вчетверо длиннее, только удлинял карточку. */}
          </div>
        )}

        {/* Обсуждение встречи — то же самое обсуждение, что и у задачи:
            одна таблица, один вид, одни правила. */}
        {meeting && <ItemChat kind="meeting" itemId={meeting.id} />}

        {sendState && <div className="send-result" id="meetingSendResult">{sendState}</div>}
        {sendAt && meeting && (
          <SendMenu kind="meeting" id={meeting.id} concerns={participants} anchor={sendAt} onClose={() => setSendAt(null)} onResult={setSendState} />
        )}

        <div className="modal-actions">
          <div className="left">
            {isEditing && canEdit && (
              <button
                className="btn btn-danger-ghost"
                id="deleteMeetingBtn"
                onClick={() =>
                  void (async () => {
                    const yes = await ask.confirm({ question: "Удалить эту встречу?", okText: "Удалить", danger: true });
                    if (!yes) return;
                    onDelete();
                    onClose();
                  })()
                }
              >
                Удалить
              </button>
            )}
          </div>
          <div className="left">
            {canSend && (
              <button
                className="btn"
                id="sendMeetingBtn"
                type="button"
                title="Отправить встречу участнику в мессенджер"
                onClick={(e) => setSendAt(e.currentTarget.getBoundingClientRect())}
              >
                <Icon name="send" size={15} /> Отправить
              </button>
            )}
            <button className="btn" id="meetingCancelBtn" onClick={onClose}>
              Отмена
            </button>
            {canEdit && (
              <button className="btn btn-primary" id="meetingSaveBtn" onClick={save}>
                Сохранить
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
