"use client";

// Port of the meeting modal from trackerMarkup.ts + openMeetingModal()/
// meetingSaveBtn/deleteMeetingBtn/setMeetingStatus/performReschedule in
// legacy-tracker.js. Kept on the same element ids for e2e-pattern reuse.
import { useMemo, useState } from "react";
import { useColleagues } from "@/hooks/useColleagues";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import SendMenu from "./SendMenu";
import ItemChat from "./ItemChat";
import MeetingAnswer from "./MeetingAnswer";
import type { MeetingVoteRow } from "@/hooks/useMeetingVotes";
import type { Meeting, MeetingPrefill, MeetingStatus } from "@/types/tracker";
import { fmtDate } from "@/lib/taskDisplay";
import { isSelfAssignee, sanitizeAssigneeList } from "@/lib/trackerRows";
import { withoutSelfMark } from "@/lib/actorName";
import { uid } from "@/lib/uid";
import MicButton from "./MicButton";
import MiniCalendar from "./MiniCalendar";
import AutoGrowTextarea from "./AutoGrowTextarea";
import { useAsk } from "@/components/Ask";
import { sortNames } from "@/lib/peopleOrder";
import Modal from "./Modal";
import Icon from "./Icon";
import ChipChoice from "./ChipChoice";
import { busyStarts, minutesOf, slotOf } from "@/lib/meetingTime";

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
  dayMeetings = [],
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
  // Все встречи пространства — из них считается, кто уже занят в
  // выбранный день. Приходят готовым списком: панель их и так держит,
  // а запрос ради занятости означал бы ожидание там, где человек
  // просто листает время.
  dayMeetings?: Meeting[];
  myVote?: MeetingVoteRow | null;
  onAnswer?: (response: "yes" | "no" | "late", reason: string) => Promise<void>;
}) {
  const isEditing = !!meeting;
  const [date, setDate] = useState(meeting?.date ?? prefill?.date ?? "");
  const [title, setTitle] = useState(meeting?.title ?? prefill?.title ?? "");
  const [time, setTime] = useState(meeting?.time || prefill?.time || "10:00");
  const [participants, setParticipants] = useState<string[]>(sanitizeAssigneeList(meeting?.participants ?? prefill?.participants ?? []));
  const { colleagues } = useColleagues();
  // Кто я в этом пространстве — нужно ровно для одного: не предлагать
  // позвать самого себя (см. selectableAssignees). Ответ прошлого запуска
  // хук отдаёт сразу, сеть поправляет его фоном.
  const identity = useWorkspaceRole();
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
  // Полчаса или час. Слова Кирилла 20.09.2026: «удобный способ выбирать
  // 30 минут или час» — и это не украшение формы, а то, из чего считается
  // занятость людей: час встречи вынимает из их дня час, а не точку.
  const [durationMin, setDurationMin] = useState<number>(meeting?.durationMin || 30);

  // Кто занят в этот день и в какие получасовки.
  //
  // Слова Кирилла 20.09.2026: «чтобы другие участники работы видели,
  // что условно на 12:00 у Есиной, Мамаковой и Макарова варианта
  // выбрать встречу нету, потому что у них уже запланирована встреча».
  // Занятым человек считается по НАЗНАЧЕННОЙ встрече: предложение
  // ничьего времени не занимает, пока на него не ответили (см.
  // lib/meetingConfirm), и гасить из-за него слоты значило бы
  // блокировать день тем, что ещё не состоялось.
  //
  // Своя же встреча из расчёта исключается: открыв её, человек видел бы
  // собственное время занятым и не смог бы выбрать то, на котором и так
  // стоит.
  const busyByTime = useMemo(() => {
    const out = new Map<number, string[]>();
    if (!date) return out;
    for (const m of dayMeetings) {
      if (m.date !== date || m.status !== "planned" || m.id === meeting?.id) continue;
      const slot = slotOf(m.time, m.durationMin);
      if (!slot) continue;
      for (const start of busyStarts([slot])) {
        const names = out.get(start) || [];
        for (const name of m.participants || []) if (!names.includes(name)) names.push(name);
        out.set(start, names);
      }
    }
    return out;
  }, [dayMeetings, date, meeting?.id]);

  // Заняты ли ВЫБРАННЫЕ люди в это время. Чужая занятость, никого из
  // приглашённых не касающаяся, — не повод гасить кнопку: в трекере
  // четырнадцать человек, и при таком правиле свободных слотов не
  // осталось бы вовсе.
  const busyNamesAt = (slotTime: string): string[] => {
    const start = minutesOf(slotTime);
    if (start === null || !participants.length) return [];
    const taken = new Set<string>();
    for (let t = start; t < start + durationMin; t += 30) {
      for (const name of busyByTime.get(t) || []) if (participants.includes(name)) taken.add(name);
    }
    return [...taken];
  };

  // Esc закрывает окно — как и любое другое окно трекера.

  // Позвать нельзя только СЕБЯ — а «себя» у каждого своего.
  //
  // Здесь стоял фильтр по метке «(я)», то есть по строке владельца, и
  // читался он как «собирает всегда владелец». С паритетом постановщиков
  // (20.09.2026) собирает кто угодно, и фильтр по чужой метке означал
  // ровно одно: руководитель не мог позвать Кирилла на встречу вовсе —
  // ни голоса, ни напоминаний, ни строки «кто идёт». Своя строка у
  // владельца помечена «(я)», у руководителя — это его имя.
  const myRow = identity.isOwner ? "" : identity.name;
  const selectableAssignees = sortNames(assignees.filter((a) => (myRow ? a !== myRow : !isSelfAssignee(a))));

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
      // Длительность назначенной встречи не меняется вместе с остальным:
      // о ней уже сказали людям, и час, ставший получасом, развёл бы то,
      // что у них в календаре, и то, что записано. Меняется переносом.
      durationMin: isEditing ? meeting.durationMin || 30 : durationMin,
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
                {TIME_SLOTS.map((slot) => {
                  const busy = busyNamesAt(slot);
                  return (
                  <button
                    key={slot}
                    type="button"
                    // Занятое время не запрещено, а помечено. Запрет был бы
                    // неправдой: планёрку иногда и правда ставят поверх
                    // другой, решив, что та подождёт. Неправдой было бы и
                    // молчание — именно его Кирилл и просил убрать.
                    className={"time-slot" + (time === slot ? " selected" : "") + (busy.length ? " busy" : "")}
                    title={busy.length ? "Заняты: " + busy.join(", ") : undefined}
                    onClick={() => setTime(slot)}
                  >
                    {slot}
                  </button>
                  );
                })}
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
                    {/* Метка «(я)» написана для одного человека, а читают
                        список все: в базу уходит полное имя строки, на
                        экран — имя. */}
                    {withoutSelfMark(name)}
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
              <label>Сколько займёт</label>
              <ChipChoice
                id="mDuration"
                value={durationMin === 60 ? "60" : "30"}
                onSelect={(v) => setDurationMin(v === "60" ? 60 : 30)}
                options={[
                  { value: "30", label: "30 минут" },
                  { value: "60", label: "1 час" },
                ]}
              />
              <div className="field-hint">
                {durationMin === 60
                  ? "Час выпадает из дня у всех, кого зовёте: другие встречи на это время им уже не поставят незаметно."
                  : "Полчаса — обычная планёрка. Занятое время видно остальным при выборе."}
              </div>
            </div>

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
