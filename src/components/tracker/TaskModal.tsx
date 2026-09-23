"use client";

// Faithful port of the task modal from src/app/trackerMarkup.ts + the
// openModal()/saveTaskBtn/deleteTaskBtn/stopRecurBtn handlers in
// public/legacy-tracker.js. Kept on the same element ids (#overlay,
// #fTitle, #saveTaskBtn, etc.) so the existing e2e patterns keep working
// against the new UI with minimal changes.
import { useEffect, useState } from "react";
import type { RecurKind, Section, Task, TaskPrefill } from "@/types/tracker";
import { markTaskCommentsRead } from "@/hooks/useUnreadTaskComments";
import { uid } from "@/lib/uid";
import TeamCompact from "./TeamCompact";
import TaskAnswer from "./TaskAnswer";
import ItemChat from "./ItemChat";
import { STAGE_LABEL, taskStage, type TaskParticipantRole } from "@/lib/taskProgress";
import type { Participant, PendingParticipant, PersonOption } from "@/hooks/useTaskParticipants";
import PeoplePicker, { type PickedPerson } from "./PeoplePicker";
import ChipChoice from "./ChipChoice";
import MiniCalendar from "./MiniCalendar";
import MicButton from "./MicButton";
import AutoGrowTextarea from "./AutoGrowTextarea";
import { useAsk } from "@/components/Ask";
import Modal from "./Modal";
import Icon from "./Icon";
import ItemFacts from "./ItemFacts";
import ResultFiles from "./ResultFiles";
import { useAuthors } from "@/hooks/useAuthors";
import { authorLabel } from "@/lib/authorName";
import { withoutSelfMark } from "@/lib/actorName";
import { fmtDate } from "@/lib/taskDisplay";

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

// Дата и время — одной строкой, для сводки и для отчётов. Час и минуты
// здесь не педантизм: «сделал вчера в 18:40» и «сделал сегодня в 9:05» —
// разные ответы на вопрос, почему работа встала.
function whenCreated(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyForm(task: Task | null, prefill?: TaskPrefill) {
  return {
    title: task?.title ?? prefill?.title ?? "",
    desc: task?.desc ?? prefill?.desc ?? "",
    assignee: task?.assignee ?? prefill?.assignee ?? "",
    sectionId: task?.sectionId ?? prefill?.sectionId ?? "",
    term: task?.term ?? "short",
    deadline: task?.deadline ?? prefill?.deadline ?? "",
    recur: task?.recur ?? "none",
    recurWeekday: task?.recurWeekday || "1",
    recurWeekdays: task?.recurWeekdays ?? [],
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
  onReopenWork,
  onAcceptReschedule,
  onRejectReschedule,
  onPersonAdded,
  canEdit = true,
  isAdmin = true,
  myAssigneeId = "",
  onAcceptWork,
  onReportWork,
  onDeclineWork,
  onAskReschedule,
}: {
  task: Task | null;
  prefill?: TaskPrefill;
  sections: Section[];
  onSave: (task: Task, pendingParticipants: PendingParticipant[]) => void;
  onDelete: () => void;
  onClose: () => void;
  onAddAssignee: (name: string) => void;
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
  onReopenWork: (comment: string) => void;
  onAcceptReschedule: (participantId: string, date: string) => void;
  onRejectReschedule: (participantId: string) => void;
  // Дождаться, пока только что заведённый человек доедет до базы, и
  // перечитать список: без id его нельзя поставить на задачу.
  onPersonAdded?: (name: string) => void | Promise<void>;
  // Чужая задача, которую видно.
  //
  // Руководитель видит задачи, где он исполнитель, — и до сих пор ему
  // показывались все кнопки: срок, состав, приёмка, «Удалить». База на
  // каждую из них ответила бы отказом (миграция 0019: участие в задаче не
  // даёт права её править), но отказала бы МОЛЧА — задача исчезла бы из
  // списка до перезагрузки и вернулась после неё. Кнопка, ведущая к отказу,
  // хуже отсутствующей; здесь она ещё и обманывает.
  //
  // Что остаётся у чужой задачи: прочитать, написать в обсуждение — и
  // ответить по ней, если она поручена тебе (см. TaskAnswer ниже).
  canEdit?: boolean;
  // Справочники трекера — люди и разделы — заводит администратор, и
  // только он. Слова Кирилла 20.09.2026: «кнопки с возможностью добавить
  // раздел или человека должны быть только у меня, как у администратора,
  // у остальных они должны быть скрыты». Это та же граница, что у строки
  // разделов под доской (SectionTabs.canEdit) и у «Команды»: список людей
  // общий на всё пространство, и человек, заведённый кем угодно, появится
  // у всех четырнадцати.
  isAdmin?: boolean;
  // Моя строка в списке людей. По ней карточка находит, стою ли я на этой
  // задаче и чего от меня ждут (см. lib/ownership.myAssigneeId).
  myAssigneeId?: string;
  onAcceptWork?: (participantId: string) => Promise<void>;
  // Отчёт вместе с документами: файлы грузит хук, маршрут получает их
  // описания (см. lib/resultFiles и миграцию 0039).
  onReportWork?: (participantId: string, comment: string, files: File[]) => Promise<void>;
  onDeclineWork?: (participantId: string, reason: string) => Promise<void>;
  onAskReschedule?: (participantId: string, to: string, reason: string) => Promise<void>;
}) {
  const ask = useAsk();
  // Кто из логинов какой человек — по этому имени подписан постановщик.
  const authors = useAuthors();
  // Открыли карточку — обсуждение внутри неё прочитано: значок
  // «непрочитано» на кубике доски снимается с этой задачи на этом
  // устройстве (см. useUnreadTaskComments).
  useEffect(() => {
    if (task?.id) markTaskCommentsRead(task.id);
  }, [task?.id]);
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
    const out: PendingParticipant[] = [];
    const add = (name: string, role: PendingParticipant["role"]) => {
      const person = availablePeople.find((p) => p.name === name.trim());
      if (person && !out.some((x) => x.assigneeId === person.id)) out.push({ assigneeId: person.id, name: person.name, role });
    };
    // Разобранная фраза называет исполнителей и ничего не знает о ролях.
    for (const name of [prefill?.assignee || "", ...(prefill?.executors || [])]) if (name.trim()) add(name, "executor");
    // А правая кнопка по разделу приносит людей вместе с их ролями в нём.
    for (const person of prefill?.people || []) add(person.name, person.role);
    return out;
  });
  // Описание раскрыто только там, где оно уже написано.
  const [descOpen, setDescOpen] = useState(() => !!(task?.desc || prefill?.desc));

  // Esc закрывает карточку — как и любое другое окно трекера.

  const isEditing = !!task;

  // Моя собственная строка на этой задаче, если я на ней стою. Объявлена
  // ЗДЕСЬ, выше первого использования, и переносить ниже нельзя: `const` в
  // теле компонента, позванный выше своей строки, убивает весь экран (см.
  // правило в CLAUDE.md — это стоило половины дня).
  const myPart = myAssigneeId ? participants.find((p) => p.assigneeId === myAssigneeId) || null : null;

  // Состав по ролям — для сводки. Имена без пометки «(я)»: она написана
  // для одного человека, а карточку читают все.
  const namesWithRole = (role: TaskParticipantRole) =>
    participants.filter((p) => p.role === role).map((p) => withoutSelfMark(p.name || ""));
  const executorNames = namesWithRole("executor");
  const coexecutorNames = namesWithRole("coexecutor");
  const watcherNames = namesWithRole("watcher");

  // Кто и когда отчитался. Порядок — по времени отчёта: последний сверху
  // читался бы как «главный», а их складывают в том порядке, в котором
  // работу сдавали.
  const reports = participants
    .filter((p) => p.doneAt)
    .map((p) => ({ ...p, name: withoutSelfMark(p.name || "") }))
    .sort((a, b) => (a.doneAt || "").localeCompare(b.doneAt || ""));

  // Стадия задачи — тем же бейджем, что раньше стоял над списком «Кто на
  // задаче», только теперь в сводке (ItemFacts): Кирилл 22.09.2026 попросил
  // перенести его туда, «в такой же аккуратной форме».
  const stage = task ? taskStage(participants, task.approvalState || "open") : null;

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

  // Кнопки «Отправить» в карточке больше нет.
  //
  // Слова Кирилла 21.09.2026: «что значит эта нижняя серая дополнительная
  // кнопка „отправить“? там предлагается выбор кому отправить вне задачи???
  // что за бред? где логика? удали её за ненадобностью». Он прав: задача
  // уходит исполнителю в момент назначения (assignWork.ts), и это одно из
  // трёх уведомлений, которые нельзя отключить. Вторая кнопка рядом с
  // «Сохранить» предлагала послать ту же задачу кому-то ЕЩЁ — человеку, не
  // имеющему к ней отношения, — то есть отвечала на вопрос, которого в
  // карточке никто не задаёт, и выглядела вторым способом поручить.
  // Показать задачу постороннему по-прежнему можно из списка (✈ в меню
  // карточки), где это и есть отдельное действие, а не часть формы.

  function save() {
    const title = form.title.trim();
    if (!title) {
      void ask.say({ title: "Название не заполнено", question: "Укажите название задачи." });
      return;
    }
    // Исполнитель обязателен — и при создании, и при правке.
    //
    // Кирилл сказал это правилом: «без исполнителя запрети создавать»,
    // соисполнитель и наблюдатель — по желанию. Задача без исполнителя
    // никому не уходит, ни в чьей сводке не появляется и никем не может
    // быть закрыта: закрывается она тогда, когда отчитается каждый
    // исполнитель, а если исполнителей ноль — «каждый» выполнен сразу и
    // она висит вечно. Ровно это и находил scripts/check-assignments.mjs
    // («две задачи назначены никому»), и дешевле не дать её завести, чем
    // потом искать.
    //
    // Проверка стоит и на правке тоже, а не только на создании: снять
    // единственного исполнителя и нажать «Сохранить» — это тот же самый
    // результат, полученный в два нажатия, и запрет, который обходится в
    // два нажатия, — не запрет. picked одинаково описывает и набранный
    // состав новой задачи, и настоящие строки участия сохранённой.
    if (!picked.some((p) => p.role === "executor")) {
      void ask.say({
        title: "Нужен исполнитель",
        question: "У задачи должен быть хотя бы один исполнитель — тот, кто по ней отчитается.",
        note: "Нажмите человека в поле «Кто на задаче» и выберите «Исполнитель». Соисполнитель и наблюдатель — по желанию.",
      });
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
      // Приоритета в форме больше нет (см. ниже): у заведённой задачи
      // сохраняется то, что в ней уже стоит, у новой — обычный.
      priority: task?.priority ?? "med",
      term: form.term as Task["term"],
      status: task?.status ?? "in_progress",
      deadline: form.deadline,
      recur: form.recur as RecurKind,
      recurWeekday: form.recurWeekday,
      recurWeekdays: form.recurWeekdays,
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
    setForm((f) => ({ ...f, recur: "none", recurWeekday: "1", recurWeekdays: [], recurMonthday: "", recurYearDay: "", recurYearMonth: "1" }));
    if (task) onSave({ ...task, recur: "none", recurWeekday: "1", recurWeekdays: [], recurMonthday: "", recurYearDay: "", recurYearMonth: "1" }, []);
  }

  // Выбранные дни недели. Пустой массив у старой задачи означает «читай
  // одиночный день» — то же правило, что в taskDisplay.recurDays.
  const pickedDays = (form.recurWeekdays || []).length ? form.recurWeekdays : [form.recurWeekday];
  const isWorkweek = ["1", "2", "3", "4", "5"].every((d) => pickedDays.includes(d)) && pickedDays.length === 5;

  function toggleWeekday(value: string) {
    setForm((f) => {
      const current = (f.recurWeekdays || []).length ? f.recurWeekdays : [f.recurWeekday];
      const next = current.includes(value) ? current.filter((d) => d !== value) : [...current, value];
      // Последний день не снимается: повтор без дней не повторяется никогда,
      // и задача молча перестала бы появляться.
      if (!next.length) return f;
      return { ...f, recurWeekdays: next, recurWeekday: next[0] };
    });
  }

  const showStopRecur = isEditing && form.recur !== "none";

  // Срок стоит в разных местах у новой задачи и у заведённой, поэтому живёт
  // здесь, а не дважды в разметке. У новой он в общем ряду полей; у
  // заведённой — сразу под названием, потому что перенести срок это одно из
  // четырёх действий, ради которых её вообще открывают, и искать его под
  // лентой обсуждения было бы издевательством.
  const deadlineField = (
    <div className="field">
      {/* «Срок», а не «Дедлайн / дата»: интерфейс русский весь, и одно
          английское слово в подписи поля читается как чужое — та же
          причина, по которой из трекера ушёл моноширинный шрифт. Косая
          черта с двумя названиями к тому же спрашивала дважды об одном. */}
      <label>Срок</label>
      {/* Календарь показан сразу, а не спрятан за значком в поле
          «дд.мм.гггг»: срок — это вопрос про день недели и про то, сколько
          до него осталось, и на него отвечает сетка месяца, а не восемь
          цифр. Тремя кнопками рядом ставятся сроки, которые ставят чаще
          всего.

          Календарь стоит в ОДНОЙ строке с этими кнопками, а не над ними.
          Раскрываясь, он занимает место следующей строки — и когда эта
          строка была строкой с «Сегодня / Завтра / Через неделю», выходило,
          что кнопки наполовину скрыты, наполовину торчат из-под сетки:
          ровно то, что Кирилл назвал «кнопки залазят друг на друга». */}
      <div className="deadline-row">
        <MiniCalendar
          popover
          id="fDeadline"
          value={form.deadline}
          onChange={(iso) => setForm((f) => ({ ...f, deadline: iso }))}
          clearable
        />
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
  );

  return (
    <Modal id="overlay" onClose={onClose} dismissOnBackdrop={false}>
      <div className={"modal" + (task ? " has-chat" : "")}>
        {/* Заведённая задача — не черновик.

            Слова Кирилла: «убирай всё лишнее, в ней должен остаться чат,
            возможность перенести дедлайн и добавить соисполнителей,
            исполнителей и наблюдателей и возможность принять или вернуть на
            доработку». Он прав ровно по той причине, по которой перестали
            редактироваться назначенные встречи: задачу уже отправили
            человеку, он её принял и по ней отчитывается — а название,
            раздел, приоритет и срочность правятся в этот момент в никуда.
            Их видел он, их видит бот, их помнит переписка, и тихая правка у
            себя в окне разводит то, что записано, и то, что люди видели.

            Что остаётся, перечислено им: срок (его двигает постановщик —
            это его право по правилам проекта), состав, приёмка, обсуждение.
            Всё остальное показывается как есть, без полей.

            Новая задача открывается полной формой: пока её никто не видел,
            править в ней можно что угодно. */}
        <h2 id="modalTitle">{isEditing ? form.title || "Задача" : "Новая задача"}</h2>
        <input type="hidden" id="taskId" value={task?.id ?? ""} readOnly />

        {/* Заведённая задача разворачивается в два столбца на десктопе:
            слева всё функциональное (сводка, состав, приёмка), справа —
            обсуждение. Слова Кирилла 22.09.2026: «хочу, чтобы в версии
            для ПК чат был правее функционального окна задачи, так легче
            управлять бегунком задачи и чата по отдельности». Оба столбца
            прокручиваются независимо (см. .modal.has-chat в tracker.css);
            на телефоне и на узком окне .modal-split ничего не значит
            (display:contents) и всё просто идёт одной колонкой, как раньше. */}
        {task ? (
          <div className="modal-split">
            <div className="modal-main">
              {form.desc && <div className="task-card-desc">{form.desc}</div>}

              {/* Первым — то, чего ждут ОТ ВАС: ради этого карточку и
                  открывают, когда задачу поручили вам. Ниже идёт всё
                  остальное, что о ней известно. */}
              {myPart && (
                <TaskAnswer
                  me={myPart}
                  closed={task.status === "done" || task.approvalState === "accepted"}
                  deadline={task.deadline || ""}
                  returnedComment={task.approvalState === "returned" ? task.approvalComment || "" : ""}
                  onAccept={() => onAcceptWork?.(myPart.id) ?? Promise.resolve()}
                  onReport={(comment, files) => onReportWork?.(myPart.id, comment, files) ?? Promise.resolve()}
                  onDecline={(reason) => onDeclineWork?.(myPart.id, reason) ?? Promise.resolve()}
                  onAskReschedule={(to, reason) => onAskReschedule?.(myPart.id, to, reason) ?? Promise.resolve()}
                  onAnswered={onClose}
                />
              )}

              {/* Главное о задаче — одной короткой таблицей, сразу под
                  названием. Слова Кирилла 21.09.2026: «требуется компактное
                  окно с основной информацией о задаче, в которое входит:
                  кто постановщик → напротив дата постановки задачи, кто
                  исполнитель → напротив крайний срок выполнения (дедлайн),
                  далее соисполнители (списком), далее наблюдатели
                  (списком)». Бейдж стадии («в работе», «на приёмке»…)
                  переехал сюда же 22.09.2026 — раньше он стоял отдельной
                  строкой над списком «Кто на задаче». */}
              <ItemFacts
                id="taskFacts"
                badge={stage && <span className={"tp-stage tp-stage-" + stage}>{STAGE_LABEL[stage]}</span>}
                rows={[
                  {
                    left: { label: "Постановщик", value: authorLabel(task.createdBy, authors, availablePeople.map((p) => p.name)) },
                    right: { label: "Дата постановки", value: whenCreated(task.createdAt || "") || "—", muted: !task.createdAt },
                  },
                  {
                    left: {
                      label: executorNames.length > 1 ? "Исполнители" : "Исполнитель",
                      value: executorNames.length ? executorNames.join(", ") : "не назначен",
                      muted: !executorNames.length,
                    },
                    right: {
                      label: "Крайний срок",
                      value: task.deadline ? fmtDate(task.deadline) : "без срока",
                      muted: !task.deadline,
                    },
                  },
                  ...(coexecutorNames.length
                    ? [{ wide: { label: "Соисполнители", value: coexecutorNames.join(", ") } } as const]
                    : []),
                  ...(watcherNames.length ? [{ wide: { label: "Наблюдатели", value: watcherNames.join(", ") } } as const] : []),
                ]}
              />

              {/* Результат — то, ради чего приёмку вообще открывают.
                  Кирилл просил «поле Результат с датой и временем
                  проведения», чтобы постановщик «мог прочесть данные по
                  результату и принять решение». */}
              {reports.length > 0 && (
                <div className="results" id="taskResults">
                  <div className="results-head">Результат</div>
                  {reports.map((r) => (
                    <div className="result-item" key={r.id}>
                      <div className="result-line">
                        <span className="result-who">{r.name}</span>
                        <span className="result-when">{whenCreated(r.doneAt || "")}</span>
                      </div>
                      <div className="result-text">{r.doneComment || "без комментария"}</div>
                      {/* Документы лежат ЗДЕСЬ, у результата, а не в
                          обсуждении: на приёмке акт или фотография нужны
                          ровно в эту секунду. */}
                      <ResultFiles files={r.doneFiles || []} />
                    </div>
                  ))}
                </div>
              )}

              {!canEdit && (
                <div className="task-card-note">
                  Эту задачу поставил не вы — менять её может только постановщик. Написать в обсуждение можно.
                </div>
              )}

              {/* У заведённой задачи срок идёт первым: перенести его —
                  одно из действий, ради которых её открывают. */}
              {canEdit && deadlineField}

              {/* Состав, статус каждого и приёмка — одним компактным
                  блоком вместо прежних двух («Кто на задаче» списком
                  кнопок и под ним ещё раз списком строк). Слова Кирилла
                  22.09.2026: «оба блока «кто на задаче» — не нужны, но
                  какая-то возможность добавить исполнителей должна
                  присутствовать, но не занимать много места… функцию на
                  стадии приёмки тоже перенести вверх». */}
              {canEdit && (
                <TeamCompact
                  participants={participants}
                  availablePeople={availablePeople}
                  approvalState={task.approvalState || "open"}
                  approvalComment={task.approvalComment}
                  onAddParticipant={onAddParticipant}
                  onSetParticipantRole={onSetParticipantRole}
                  onRemoveParticipant={onRemoveParticipant}
                  onApproveWork={onApproveWork}
                  onReturnWork={onReturnWork}
                  onForceCloseWork={onForceCloseWork}
                  onReopenWork={onReopenWork}
                  onAcceptReschedule={onAcceptReschedule}
                  onRejectReschedule={onRejectReschedule}
                  onAddPerson={isAdmin ? () => void handleAddAssignee() : undefined}
                />
              )}
            </div>

            <div className="modal-chat-pane">
              <ItemChat kind="task" itemId={task.id} mentionCandidates={participants.map((p) => p.name)} />
            </div>
          </div>
        ) : (
          <>
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

            {/* Описание убрано с глаз: в девяти задачах из десяти его не
                пишут, а поле в два ряда стояло вторым сверху и отодвигало
                всё, ради чего карточку открывают. */}
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
                местах; теперь человек выбирается нажатием, а роль —
                маленьким меню у самой кнопки (см. PeoplePicker). */}
            {canEdit && (
              <PeoplePicker
                people={availablePeople}
                picked={picked}
                onPick={pickPerson}
                onRemove={removePerson}
                onAddPerson={isAdmin ? () => void handleAddAssignee() : undefined}
              />
            )}
          </>
        )}

        {/* Раздел, приоритет, срочность и повторение — только у новой
            задачи. У заведённой их правка ни до кого не доходит: человеку
            уже отправили задачу такой, какая она есть, и менять её у себя в
            окне значит развести то, что записано, и то, что он видел. То же
            решение, что у назначенной встречи, и по той же причине. */}
        {!isEditing && (
        <>
        <div className="field">
          <label>Раздел</label>
          <ChipChoice
            id="fSection"
            value={form.sectionId}
            options={[{ value: "", label: "Без раздела" }, ...sections.map((s) => ({ value: s.id, label: s.name }))]}
            onSelect={(id) => setForm((f) => ({ ...f, sectionId: id }))}
            extra={
              <>
                {/* Завести и удалить раздел может только администратор:
                    разделы — структура пространства, общая на всех, и
                    база откажет остальным (миграция 0031). Кнопка,
                    ведущая к молчаливому отказу, хуже отсутствующей. */}
                {isAdmin && (
                  <button
                    type="button"
                    className="participant-chip chip-add"
                    id="addSectionBtn"
                    title="Добавить раздел"
                    onClick={() => void handleAddSection()}
                  >
                    + раздел
                  </button>
                )}
                {isAdmin && form.sectionId && (
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

        {/* Ни «Приоритета», ни «Срочности» здесь больше нет — оба поля
            ушли по одной и той же причине и по прямым словам Кирилла:
            «долгосрочные и краткосрочные задачи соединить просто в
            „Задачи“, критерий краткосрочности или долгосрочности вообще
            удали» (19.09.2026) и «удали везде приоритетности, они не
            нужны» (20.09.2026). Оба выставлялись руками при заведении и
            дальше жили сами по себе: задача со «средним» приоритетом
            лежала месяцами рядом с «высоким», и слово говорило не о деле,
            а о настроении, в котором его записали. Что горит — отвечает
            срок, где задача сейчас — доска, а она выводится из работы
            (lib/kanban). */}

        {deadlineField}

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
            <label>Дни недели</label>
            {/* Несколько дней, а не один.

                «Каждый понедельник и четверг» и «по будням» — половина
                повторяющихся поручений, и до сих пор каждое из них
                заводилось двумя задачами с одинаковым названием, которые
                дальше жили порознь: одну закрыли, вторую забыли.

                Кнопки те же, что были, только нажатие теперь добавляет и
                снимает. Снять последний день нельзя: повтор без единого дня
                не повторяется никогда, и задача молча перестала бы
                появляться. */}
            <div className="chip-row" id="fRecurWeekday">
              {WEEKDAY_OPTIONS.map((o) => {
                const on = pickedDays.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={"participant-chip" + (on ? " selected" : "")}
                    data-value={o.value}
                    aria-pressed={on}
                    title={o.label}
                    onClick={() => toggleWeekday(o.value)}
                  >
                    {o.short}
                  </button>
                );
              })}
              <button
                type="button"
                className={"participant-chip" + (isWorkweek ? " selected" : "")}
                data-value="workweek"
                aria-pressed={isWorkweek}
                title="Понедельник — пятница"
                onClick={() => setForm((f) => ({ ...f, recurWeekdays: ["1", "2", "3", "4", "5"], recurWeekday: "1" }))}
              >
                Будни
              </button>
            </div>
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
              <Icon name="ban" size={14} /> Прекратить повторение
            </button>
          </div>
        </div>
        </>
        )}

        <div className="modal-actions">
          <div className="left">
            {isEditing && canEdit && (
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
            <button className="btn" id="cancelBtn" onClick={onClose}>
              {canEdit ? "Отмена" : "Закрыть"}
            </button>
            {canEdit && (
              <button className="btn btn-primary" id="saveTaskBtn" onClick={save}>
                Сохранить
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
