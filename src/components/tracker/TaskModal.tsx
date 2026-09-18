"use client";

// Faithful port of the task modal from src/app/trackerMarkup.ts + the
// openModal()/saveTaskBtn/deleteTaskBtn/stopRecurBtn handlers in
// public/legacy-tracker.js. Kept on the same element ids (#overlay,
// #fTitle, #saveTaskBtn, etc.) so the existing e2e patterns keep working
// against the new UI with minimal changes.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useColleagues } from "@/hooks/useColleagues";
import SendMenu from "./SendMenu";
import type { RecurKind, Section, Task, TaskPrefill } from "@/types/tracker";
import { uid } from "@/lib/uid";
import TaskParticipants from "./TaskParticipants";
import ItemChat from "./ItemChat";
import type { TaskParticipantRole } from "@/lib/taskProgress";
import type { Participant, PendingParticipant, PersonOption } from "@/hooks/useTaskParticipants";
import PeoplePicker, { type PickedPerson } from "./PeoplePicker";
import ChipChoice from "./ChipChoice";
import MiniCalendar from "./MiniCalendar";
import MicButton from "./MicButton";
import AutoGrowTextarea from "./AutoGrowTextarea";
import { useAsk } from "@/components/Ask";

// Короткая подпись — для кнопки, полная — для подсказки под курсором: семь
// «Понедельник…Воскресенье» подряд не помещаются никуда, а «Пн Вт Ср» читают
// не читая.
const WEEKDAY_OPTIONS = [
  { value: "1", label: "Понедельник", short: "Пн" },
  { value: "2", label: "Вторник", short: "Вт" },
  { value: "3", label: "Среда", short: "Ср" },
  { value: "4", label: "Четверг", short: "Чт" },
  { value: "5", label: "Пятница", short: "Пт" },
  { value: "6", label: "Суббота", short: "Сб" },
  { value: "0", label: "Воскресенье", short: "Вс" },
];
const MONTH_OPTIONS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
].map((label, i) => ({ value: String(i + 1), label, short: label.slice(0, 3) }));

// Сроки, которые ставят чаще всего. Считаются от сегодняшнего дня по местному
// времени — то же, что делает календарь трекера.
const QUICK_DEADLINES = [
  { label: "Сегодня", days: 0 },
  { label: "Завтра", days: 1 },
  { label: "Через неделю", days: 7 },
];

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyForm(task: Task | null, prefill?: TaskPrefill) {
  return {
    title: task?.title ?? prefill?.title ?? "",
    desc: task?.desc ?? prefill?.desc ?? "",
    assignee: task?.assignee ?? prefill?.assignee ?? "",
    sectionId: task?.sectionId ?? "",
    priority: task?.priority ?? prefill?.priority ?? "med",
    term: task?.term ?? prefill?.term ?? "short",
    deadline: task?.deadline ?? prefill?.deadline ?? "",
    recur: task?.recur ?? "none",
    recurWeekday: task?.recurWeekday || "1",
    recurMonthday: task?.recurMonthday ?? "",
    recurYearDay: task?.recurYearDay ?? "",
    recurYearMonth: task?.recurYearMonth || "1",
  };
}

export default function TaskModal({
  task,
  prefill,
  sections,
  onSave,
  onDelete,
  onClose,
  onAddAssignee,
  onRemoveAssignee,
  onAddSection,
  onRemoveSection,
  participants,
  availablePeople,
  onAddParticipant,
  onSetParticipantRole,
  onRemoveParticipant,
  onApproveWork,
  onReturnWork,
  onForceCloseWork,
  onAcceptReschedule,
  onRejectReschedule,
  onScheduleMeeting,
  onPersonAdded,
}: {
  task: Task | null;
  prefill?: TaskPrefill;
  sections: Section[];
  onSave: (task: Task, pendingParticipants: PendingParticipant[]) => void;
  onDelete: () => void;
  onClose: () => void;
  onAddAssignee: (name: string) => void;
  onRemoveAssignee: (name: string) => void;
  onAddSection: (section: Section) => void;
  onRemoveSection: (id: string) => void;
  participants: Participant[];
  availablePeople: PersonOption[];
  onAddParticipant: (assigneeId: string, role: TaskParticipantRole) => void | Promise<string | void>;
  onSetParticipantRole: (participantId: string, role: TaskParticipantRole) => void;
  onRemoveParticipant: (participantId: string) => void;
  onApproveWork: (comment: string) => void;
  onReturnWork: (comment: string) => void;
  onForceCloseWork: (reason: string) => void;
  onAcceptReschedule: (participantId: string, date: string) => void;
  onRejectReschedule: (participantId: string) => void;
  // «Назначить встречу по задаче» (C5). Задача остаётся задачей: встреча —
  // это то, где по ней соберутся, а не то, чем она станет.
  onScheduleMeeting?: (task: Task, participants: string[]) => void;
  // Дождаться, пока только что заведённый человек доедет до базы, и
  // перечитать список: без id его нельзя поставить на задачу.
  onPersonAdded?: (name: string) => void | Promise<void>;
}) {
  const { colleagues } = useColleagues();
  const ask = useAsk();
  const [sendState, setSendState] = useState("");
  const [sendAt, setSendAt] = useState<DOMRect | null>(null);
  const [form, setForm] = useState(() => emptyForm(task, prefill));
  // Состав новой задачи держится здесь до сохранения: строки участия
  // ссылаются на задачу, а её ещё нет в базе (см. PendingParticipants).
  //
  // Начальное значение — то, что назвала разобранная фраза: «поручи Игорю
  // и Никите» открывает карточку уже с двумя исполнителями, а не с одним и
  // потерянным вторым. Список людей к этому моменту давно загружен (он
  // читается при запуске приложения), поэтому имена находятся сразу.
  //
  // Сюда же попадает и тот, кого раньше называло отдельное поле
  // «Исполнитель»: поле теперь одно, а имя первого исполнителя уходит в
  // tasks.assignee при сохранении (см. save).
  const [pending, setPending] = useState<PendingParticipant[]>(() => {
    const names = [prefill?.assignee || "", ...(prefill?.executors || [])].map((n) => (n || "").trim()).filter(Boolean);
    const out: PendingParticipant[] = [];
    for (const name of names) {
      const person = availablePeople.find((p) => p.name === name);
      if (person && !out.some((x) => x.assigneeId === person.id)) {
        out.push({ assigneeId: person.id, name: person.name, role: "executor" });
      }
    }
    return out;
  });
  // Описание раскрыто только там, где оно уже написано.
  const [descOpen, setDescOpen] = useState(() => !!(task?.desc || prefill?.desc));

  // Esc closes the modal, same as legacy's global keydown handler.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const isEditing = !!task;

  // Кто сейчас на задаче — одинаково для новой и для сохранённой, чтобы
  // поле людей было одно и то же в обоих случаях. У новой это набранный
  // состав, у сохранённой — настоящие строки участия.
  const picked: PickedPerson[] = isEditing
    ? participants.map((p) => ({ id: p.assigneeId, name: p.name, role: p.role }))
    : pending.map((p) => ({ id: p.assigneeId, name: p.name, role: p.role }));

  function pickPerson(person: PersonOption, role: TaskParticipantRole) {
    if (!isEditing) {
      setPending((prev) => {
        const without = prev.filter((p) => p.assigneeId !== person.id);
        return [...without, { assigneeId: person.id, name: person.name, role }];
      });
      return;
    }
    const existing = participants.find((p) => p.assigneeId === person.id);
    if (existing) {
      onSetParticipantRole(existing.id, role);
      return;
    }
    void onAddParticipant(person.id, role);
    // Имя в самой задаче — только если его там ещё нет: это подпись «для
    // кого это вообще», и перебивать её вторым исполнителем незачем.
    if (role === "executor" && !form.assignee.trim()) setForm((f) => ({ ...f, assignee: person.name }));
  }

  function removePerson(p: PickedPerson) {
    if (!isEditing) {
      setPending((prev) => prev.filter((x) => x.assigneeId !== p.id));
      return;
    }
    const row = participants.find((x) => x.assigneeId === p.id);
    if (row) onRemoveParticipant(row.id);
    if (form.assignee.trim() === p.name) setForm((f) => ({ ...f, assignee: "" }));
  }

  // Offered as soon as the task exists and there is anyone to send it to.
  // It used to require the assignee to be connected, which made the ordinary
  // «покажи это Ане» impossible: the menu now offers the assignee first and
  // everyone else after (see SendMenu).
  const linkedNames = colleagues.filter((c) => c.linked).map((c) => c.name);
  const canSend = isEditing && linkedNames.length > 0;

  function save() {
    const title = form.title.trim();
    if (!title) {
      void ask.say({ title: "Название не заполнено", question: "Укажите название задачи." });
      return;
    }
    // Имя в задаче — первый исполнитель из набранного состава. Поле
    // «Исполнитель» исчезло, но колонка осталась: её читают карточка,
    // фильтр, бот и сводки, и триггер миграции 0024 заводит по ней строку
    // участия, если её почему-то нет.
    const primary = pending.find((p) => p.role === "executor");
    const next: Task = {
      id: task?.id ?? uid(),
      title,
      desc: form.desc.trim(),
      assignee: isEditing ? form.assignee : primary?.name || "",
      sectionId: form.sectionId,
      priority: form.priority as Task["priority"],
      term: form.term as Task["term"],
      status: task?.status ?? "in_progress",
      deadline: form.deadline,
      recur: form.recur as RecurKind,
      recurWeekday: form.recurWeekday,
      recurMonthday: form.recurMonthday,
      recurYearDay: form.recurYearDay,
      recurYearMonth: form.recurYearMonth,
      lastCompletedOn: task?.lastCompletedOn ?? "",
      manualOrder: task?.manualOrder ?? null,
      completedAt: task?.completedAt ?? "",
    };
    onSave(next, task ? [] : pending);
    onClose();
  }

  async function handleAddAssignee() {
    const v = await ask.ask({
      title: "Новый человек",
      question: "Как его зовут?",
      placeholder: "Имя и фамилия",
      okText: "Добавить",
      required: "Без имени человека не бывает.",
    });
    if (!v) return;
    const name = v.trim();
    if (!name) return;
    onAddAssignee(name);
    // Кнопка с его именем должна появиться сразу: список людей в поле —
    // строки таблицы, а заводит их движок синхронизации своим ходом.
    await onPersonAdded?.(name);
  }

  async function handleRemovePersonFromList(name: string) {
    const yes = await ask.confirm({
      question: `Удалить «${name}» из списка людей?`,
      note: "Уже созданные задачи сохранят его имя, но поставить его на новые будет нельзя.",
      okText: "Удалить",
      danger: true,
    });
    if (!yes) return;
    onRemoveAssignee(name);
    if (form.assignee.trim() === name) setForm((f) => ({ ...f, assignee: "" }));
  }

  async function handleAddSection() {
    const v = await ask.ask({
      title: "Новый раздел",
      question: "Как назовём раздел?",
      placeholder: "Например: Сервис",
      okText: "Дальше",
      required: "У раздела должно быть название.",
    });
    if (!v) return;
    const name = v.trim();
    if (!name) return;
    // Раньше это спрашивалось как «ОК — личный, Отмена — рабочий»: вопрос, в
    // котором ответ спрятан в названиях чужих кнопок, и отменить его было
    // нельзя вовсе. Теперь обе возможности названы своими словами.
    const kind = await ask.choose({
      title: "Какой это раздел",
      question: `«${name}» — рабочий или личный?`,
      note: "Личные разделы не попадают в сводки и отчёты по работе.",
      options: [
        { value: "work", label: "Рабочий" },
        { value: "personal", label: "Личный" },
      ],
    });
    if (kind === null) return;
    const section: Section = { id: uid(), name, kind: kind === "personal" ? "personal" : "work", sortOrder: sections.length };
    onAddSection(section);
    setForm((f) => ({ ...f, sectionId: section.id }));
  }

  async function handleRemoveSection() {
    const section = sections.find((s) => s.id === form.sectionId);
    if (!section) return;
    const yes = await ask.confirm({
      question: `Удалить раздел «${section.name}»?`,
      note: "Задачи в нём останутся, но без раздела.",
      okText: "Удалить",
      danger: true,
    });
    if (yes) {
      onRemoveSection(section.id);
      setForm((f) => (f.sectionId === section.id ? { ...f, sectionId: "" } : f));
    }
  }

  async function handleStopRecur() {
    const yes = await ask.confirm({
      question: "Прекратить повторение этой задачи?",
      note: "Она останется как обычная разовая задача с текущим статусом.",
      okText: "Прекратить",
    });
    if (!yes) return;
    setForm((f) => ({ ...f, recur: "none", recurWeekday: "1", recurMonthday: "", recurYearDay: "", recurYearMonth: "1" }));
    if (task) onSave({ ...task, recur: "none", recurWeekday: "1", recurMonthday: "", recurYearDay: "", recurYearMonth: "1" }, []);
  }

  const showStopRecur = isEditing && form.recur !== "none";

  return createPortal(
    <div className="overlay open" id="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 id="modalTitle">{isEditing ? "Редактировать задачу" : "Новая задача"}</h2>
        <input type="hidden" id="taskId" value={task?.id ?? ""} readOnly />

        <div className="field">
          <label>Название задачи</label>
          <div className="input-with-mic">
            <AutoGrowTextarea
              id="fTitle"
              placeholder="Например: Согласовать прайс с поставщиком"
              value={form.title}
              onChange={(text) => setForm((f) => ({ ...f, title: text }))}
              singleLine
            />
            <MicButton value={form.title} onChange={(text) => setForm((f) => ({ ...f, title: text }))} title="Надиктовать название" />
          </div>
        </div>

        {/* Описание убрано с глаз: в девяти задачах из десяти его не пишут,
            а поле в два ряда стояло вторым сверху и отодвигало всё, ради
            чего карточку открывают. Оно тут же, если понадобится, и само
            раскрыто у задачи, где текст уже есть, — иначе написанное
            однажды стало бы невидимым. */}
        {descOpen ? (
          <div className="field">
            <label>Описание (необязательно)</label>
            <div className="input-with-mic">
              <AutoGrowTextarea id="fDesc" placeholder="Детали, контекст…" value={form.desc} onChange={(text) => setForm((f) => ({ ...f, desc: text }))} minRows={2} />
              <MicButton value={form.desc} onChange={(text) => setForm((f) => ({ ...f, desc: text }))} title="Надиктовать описание" />
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-small field-add" id="addDescBtn" onClick={() => setDescOpen(true)}>
            + описание
          </button>
        )}

        {/* Одно поле людей вместо двух. «Исполнитель» списком и «Кто на
            задаче» с выбором роли спрашивали об одном и том же в двух
            местах; теперь человек выбирается нажатием, а роль — маленьким
            меню у самой кнопки (см. PeoplePicker). Имя первого исполнителя
            по-прежнему попадает в tasks.assignee: это короткая запись «для
            кого это вообще», её читают бот, сводки и карточки. */}
        <PeoplePicker
          people={availablePeople}
          picked={picked}
          onPick={pickPerson}
          onRemove={removePerson}
          onAddPerson={() => void handleAddAssignee()}
          onDeletePerson={(person) => void handleRemovePersonFromList(person.name)}
        />

        {task && onScheduleMeeting && (
          <button
            type="button"
            className="btn btn-small tp-meeting"
            onClick={() =>
              onScheduleMeeting(
                task,
                // Зовём тех, кто на задаче, а не одно имя из поля: собираются
                // по задаче обычно всем составом.
                [...new Set([form.assignee, ...participants.filter((p) => p.role !== "watcher").map((p) => p.name)])].filter(Boolean),
              )
            }
          >
            📅 Назначить встречу по задаче
          </button>
        )}

        {/* Состав выбирается полем выше; здесь — то, чего в кнопках не
            выразить: кто принял, кто отчитался и какими словами, кто просит
            перенос, и сама приёмка. У новой задачи ничего этого ещё нет. */}
        {task && (
          <TaskParticipants
            taskId={task.id}
            participants={participants}
            approvalState={task.approvalState || "open"}
            approvalComment={task.approvalComment}
            onSetRole={onSetParticipantRole}
            onRemove={onRemoveParticipant}
            onApprove={onApproveWork}
            onReturn={onReturnWork}
            onForceClose={onForceCloseWork}
            onAcceptReschedule={onAcceptReschedule}
            onRejectReschedule={onRejectReschedule}
          />
        )}

        {/* Обсуждение — там же, где задача. Только у сохранённой: у
            несуществующей ещё нечего обсуждать. */}
        {task && <ItemChat kind="task" itemId={task.id} />}

        <div className="field">
          <label>Раздел</label>
          <ChipChoice
            id="fSection"
            value={form.sectionId}
            options={[{ value: "", label: "Без раздела" }, ...sections.map((s) => ({ value: s.id, label: s.name }))]}
            onSelect={(id) => setForm((f) => ({ ...f, sectionId: id }))}
            extra={
              <>
                <button
                  type="button"
                  className="participant-chip chip-add"
                  id="addSectionBtn"
                  title="Добавить раздел"
                  onClick={() => void handleAddSection()}
                >
                  + раздел
                </button>
                {form.sectionId && (
                  <button
                    type="button"
                    className="participant-chip chip-del"
                    id="removeSectionBtn"
                    title="Удалить выбранный раздел"
                    onClick={() => void handleRemoveSection()}
                  >
                    ✕
                  </button>
                )}
              </>
            }
          />
        </div>

        <div className="row2">
          <div className="field">
            <label>Приоритет</label>
            <ChipChoice
              id="fPriority"
              value={form.priority}
              options={[
                { value: "high", label: "Высокий" },
                { value: "med", label: "Средний" },
              ]}
              onSelect={(v) => setForm((f) => ({ ...f, priority: v as Task["priority"] }))}
            />
          </div>
          <div className="field">
            <label>Срочность</label>
            <ChipChoice
              id="fTerm"
              value={form.term}
              options={[
                { value: "short", label: "Краткосрочная" },
                { value: "long", label: "Долгосрочная" },
              ]}
              onSelect={(v) => setForm((f) => ({ ...f, term: v as Task["term"] }))}
            />
          </div>
        </div>

        <div className="field">
          <label>Дедлайн / дата</label>
          {/* Календарь показан сразу, а не спрятан за значком в поле
              «дд.мм.гггг»: срок — это вопрос про день недели и про то,
              сколько до него осталось, и на него отвечает сетка месяца, а не
              восемь цифр. Тремя кнопками рядом ставятся сроки, которые
              ставят чаще всего. */}
          <MiniCalendar
            id="fDeadline"
            value={form.deadline}
            onChange={(iso) => setForm((f) => ({ ...f, deadline: iso }))}
            clearable
          />
          <div className="deadline-row">
            {QUICK_DEADLINES.map((q) => (
              <button
                key={q.label}
                type="button"
                className={"participant-chip" + (form.deadline && form.deadline === isoInDays(q.days) ? " selected" : "")}
                onClick={() => setForm((f) => ({ ...f, deadline: isoInDays(q.days) }))}
              >
                {q.label}
              </button>
            ))}
            {form.deadline && (
              <button
                type="button"
                className="participant-chip chip-del"
                title="Убрать срок"
                onClick={() => setForm((f) => ({ ...f, deadline: "" }))}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <label>Повторение задачи</label>
          <ChipChoice
            id="fRecur"
            value={form.recur}
            options={[
              { value: "none", label: "Не повторяется" },
              { value: "daily", label: "Каждый день" },
              { value: "weekly", label: "Каждую неделю" },
              { value: "monthly", label: "Каждый месяц" },
              { value: "yearly", label: "Каждый год" },
            ]}
            onSelect={(v) => setForm((f) => ({ ...f, recur: v as RecurKind }))}
          />

          <div className={"recur-config" + (form.recur === "weekly" ? " open" : "")} id="recurWeekly">
            <label>День недели</label>
            <ChipChoice
              id="fRecurWeekday"
              compact
              value={form.recurWeekday}
              options={WEEKDAY_OPTIONS.map((o) => ({ value: o.value, label: o.short, title: o.label }))}
              onSelect={(v) => setForm((f) => ({ ...f, recurWeekday: v }))}
            />
          </div>
          <div className={"recur-config" + (form.recur === "monthly" ? " open" : "")} id="recurMonthly">
            <label>Число месяца</label>
            <input
              type="text"
              id="fRecurMonthday"
              placeholder="Например: 5 или 28"
              value={form.recurMonthday}
              onChange={(e) => setForm((f) => ({ ...f, recurMonthday: e.target.value }))}
            />
          </div>
          <div className={"recur-config" + (form.recur === "yearly" ? " open" : "")} id="recurYearly">
            <label>День и месяц</label>
            <input
              type="text"
              id="fRecurYearDay"
              placeholder="Число (напр. 15)"
              value={form.recurYearDay}
              onChange={(e) => setForm((f) => ({ ...f, recurYearDay: e.target.value }))}
            />
            <ChipChoice
              id="fRecurYearMonth"
              compact
              value={form.recurYearMonth}
              options={MONTH_OPTIONS.map((o) => ({ value: o.value, label: o.short, title: o.label }))}
              onSelect={(v) => setForm((f) => ({ ...f, recurYearMonth: v }))}
            />
          </div>

          <div className={"stop-recur-row" + (showStopRecur ? " show" : "")} id="stopRecurRow">
            <button className="btn btn-danger-ghost btn-small" id="stopRecurBtn" type="button" onClick={() => void handleStopRecur()}>
              ⏹ Прекратить повторение
            </button>
          </div>
        </div>

        {sendState && <div className="send-result" id="taskSendResult">{sendState}</div>}
        {sendAt && task && (
          <SendMenu
            kind="task"
            id={task.id}
            /* Все, кто на задаче, а не только имя из поля: меню ставит
               «кого это касается» вперёд, и после того как исполнителей
               стало несколько, один из них перестал быть всем списком. */
            concerns={[form.assignee, ...participants.map((p) => p.name)].filter(Boolean)}
            anchor={sendAt}
            onClose={() => setSendAt(null)}
            onResult={setSendState}
          />
        )}

        <div className="modal-actions">
          <div className="left">
            {isEditing && (
              <button
                className="btn btn-danger-ghost"
                id="deleteTaskBtn"
                onClick={() =>
                  void (async () => {
                    const yes = await ask.confirm({
                      question: "Удалить эту задачу?",
                      note: "Сразу после удаления её можно вернуть из уведомления — потом уже нет.",
                      okText: "Удалить",
                      danger: true,
                    });
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
                id="sendTaskBtn"
                type="button"
                title="Отправить задачу коллеге в мессенджер"
                onClick={(e) => setSendAt(e.currentTarget.getBoundingClientRect())}
              >
                ✈ Отправить
              </button>
            )}
            <button className="btn" id="cancelBtn" onClick={onClose}>
              Отмена
            </button>
            <button className="btn btn-primary" id="saveTaskBtn" onClick={save}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
