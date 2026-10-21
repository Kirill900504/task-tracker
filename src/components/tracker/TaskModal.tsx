"use client";

// Faithful port of the task modal from src/app/trackerMarkup.ts + the
// openModal()/saveTaskBtn/deleteTaskBtn/stopRecurBtn handlers in
// public/legacy-tracker.js. Kept on the same element ids (#overlay,
// #fTitle, #saveTaskBtn, etc.) so the existing e2e patterns keep working
// against the new UI with minimal changes.
import { useEffect, useRef, useState } from "react";
import type { RecurKind, Task, TaskPrefill } from "@/types/tracker";
import { markTaskCommentsRead } from "@/hooks/useUnreadTaskComments";
import { uid } from "@/lib/uid";
import TeamCompact from "./TeamCompact";
import TaskAnswer from "./TaskAnswer";
import ItemChat, { mentionPeople } from "./ItemChat";
import { STAGE_LABEL, taskStage, type TaskParticipantRole } from "@/lib/taskProgress";
import type { Participant, PendingParticipant, PersonOption } from "@/hooks/useTaskParticipants";
import PeoplePicker, { type PickedPerson } from "./PeoplePicker";
import ChipChoice from "./ChipChoice";
import MiniCalendar from "./MiniCalendar";
import MicButton from "./MicButton";
import AddButton from "./AddButton";
import AutoGrowTextarea from "./AutoGrowTextarea";
import { useAsk } from "@/components/Ask";
import Modal from "./Modal";
import Icon from "./Icon";
import ItemFacts from "./ItemFacts";
import ResultFiles from "./ResultFiles";
import { useAuthors } from "@/hooks/useAuthors";
import { authorLabel } from "@/lib/authorName";
import { withoutSelfMark } from "@/lib/actorName";
import { fmtDate, isClosed, todayStr } from "@/lib/taskDisplay";
import { isSnoozed, snoozeDay } from "@/lib/snooze";
import { chooseSnooze } from "./snoozeAsk";
import { answerWithFiles } from "@/lib/answerFiles";
import { isSelfTask } from "@/lib/selfTask";
import { isoDate, workdayIn } from "@/lib/whenDate";
import { taskProgress } from "@/lib/taskProgress";
import { uploadTaskFiles } from "@/lib/resultFiles";
import { humanError } from "@/lib/humanError";
import ItemModalHead from "./ItemModalHead";
import TaskPeople from "./TaskPeople";
import TaskDescription from "./TaskDescription";
import TaskChecklist from "./TaskChecklist";
import TaskWaitsFor, { type WaitOption } from "./TaskWaitsFor";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import AttachFiles from "./AttachFiles";
import { QUICK_FORCE_CLOSE } from "@/lib/quickAnswers";
import ArchivedMark from "./ArchivedMark";
import { useArchivedPeople } from "@/hooks/useArchivedPeople";

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

// «Завтра» и «Через неделю» — рабочим днём: в пятницу «Завтра» ставит
// понедельник, а не субботу (см. workdayIn в lib/whenDate).
function isoInDays(days: number): string {
  return isoDate(workdayIn(new Date(), days));
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
    recurWorkday: !!task?.recurWorkday,
  };
}

export default function TaskModal({
  task,
  prefill,
  onSave,
  onPatch,
  waitOptions = [],
  onDelete,
  onClose,
  onAddAssignee,
  participants,
  availablePeople,
  onAddParticipant,
  onSetParticipantRole,
  onRemoveParticipant,
  onApproveWork,
  onReturnWork,
  onWaitForAll,
  onReturnOne,
  onForceCloseWork,
  onReopenWork,
  onRepeat,
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
  onSave: (task: Task, pendingParticipants: PendingParticipant[]) => void;
  // Правка заведённой задачи — кусок, который ложится поверх ТЕКУЩЕЙ
  // строки, а не поверх снимка, с которым окно открыли. Кнопки
  // «Сохранить» у открытой задачи больше нет (13.10.2026, «любые
  // изменения… должны автоматически в ней сохраняться»), и каждое
  // изменение пишется сразу — а снимок к этому моменту может быть уже
  // старым: срок сдвинули, задачу приняли, и запись всего снимка вернула
  // бы прежнее молча.
  onPatch?: (patch: Partial<Task>) => void;
  // Открытые задачи с номером — из них выбирают «ждёт задачу» (миграция 0061).
  waitOptions?: WaitOption[];
  onDelete: () => void;
  onClose: () => void;
  onAddAssignee: (name: string) => void;
  participants: Participant[];
  availablePeople: PersonOption[];
  onAddParticipant: (assigneeId: string, role: TaskParticipantRole) => void | Promise<string | void>;
  onSetParticipantRole: (participantId: string, role: TaskParticipantRole) => void;
  onRemoveParticipant: (participantId: string) => void;
  onApproveWork: (comment: string) => void;
  // participantIds — кому именно вернуть; без них — всем, кто ответил.
  onReturnWork: (comment: string, participantIds?: string[]) => void;
  onWaitForAll?: () => void | Promise<void>;
  onReturnOne?: (participantId: string, comment: string) => void | Promise<void>;
  onForceCloseWork: (reason: string) => void;
  onReopenWork: (comment: string) => void;
  // «Повторить» у закрытой задачи (п.2.7 предложений, 07.10.2026): форма
  // новой задачи с тем же названием, описанием, разделом и людьми, но без
  // срока — срок у повторения всегда новый. Шаблонов отдельной сущностью
  // нет нарочно: типовая задача и есть прошлая такая же.
  onRepeat?: (prefill: TaskPrefill) => void;
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
  onReportWork?: (participantId: string, comment: string, files: File[], whole?: boolean) => Promise<void>;
  onDeclineWork?: (participantId: string, reason: string) => Promise<void>;
  onAskReschedule?: (participantId: string, to: string, reason: string) => Promise<void>;
}) {
  const ask = useAsk();
  // Кто из логинов какой человек — по этому имени подписан постановщик.
  const authors = useAuthors();
  // Убранные из команды: постановщик с пометкой «удалён», тегнуть его в
  // обсуждении нельзя (участники — через PersonBadge, там пометка своя).
  const isArchived = useArchivedPeople();
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
  // Задача самому себе (lib/selfTask): ни «Принял / Сделал / Не могу», ни
  // приёмки, ни волевого закрытия — разговаривать в ней не с кем. Остаётся
  // срок, который двигается прямо здесь (слова Кирилла 07.10.2026: «для
  // самого себя должна быть только функция переноса дедлайна»).
  const selfTask = !!task && canEdit && isSelfTask(participants, myAssigneeId);
  // Срок своей задачи помнится здесь: `task` у открытого окна — снимок на
  // момент открытия, и без своей копии второй перенос показывал бы первый.
  const [selfDeadline, setSelfDeadline] = useState(() => task?.deadline || "");
  // Описание и его файлы — тоже своей копией, по той же причине.
  const [descNow, setDescNow] = useState(() => ({ desc: task?.desc || "", files: task?.descFiles || [] }));
  // Записать кусок заведённой задачи. onPatch кладёт его поверх ТЕКУЩЕЙ
  // строки; без него (старый вызов) — поверх снимка, как раньше.
  function patchTask(patch: Partial<Task>) {
    if (!task) return;
    if (onPatch) onPatch(patch);
    else onSave({ ...task, ...patch }, []);
  }
  function moveOwnDeadline(iso: string) {
    if (!task || iso === selfDeadline) return;
    setSelfDeadline(iso);
    patchTask({ deadline: iso });
  }
  // Файлы к описанию НОВОЙ задачи: грузятся при сохранении, когда у неё
  // уже есть id (см. save).
  const [newDescFiles, setNewDescFiles] = useState<File[]>([]);
  const [newDescError, setNewDescError] = useState("");
  const [saving, setSaving] = useState(false);
  // «Сохранить» отдаёт задачу один раз на окно — флаг в ref, а не в
  // состоянии. В базе нашлись близнецы: «поискать БАЗЫ клиентов!» 21.09.2026,
  // две строки с РАЗНЫМИ id через 41 мс. Разные id значат, что save()
  // прошёл дважды и дважды позвал uid(): окно новой задачи не знает своей
  // задачи до сохранения, и каждое нажатие заводит новую. Прежняя защита
  // `if (saving)` читала состояние из замыкания, а оно обновляется только
  // перерисовкой — второе нажатие, пришедшее до неё (дребезг кнопки мыши,
  // двойной тап во встроенном браузере мессенджера), видело старое `false`.
  // Ref меняется сразу, и второе нажатие видит его в ту же долю секунды.
  const committedRef = useRef(false);
  // Приёмка по выбору (миграция 0060): «Без приёмки» — отчёт всех
  // исполнителей закрывает задачу сам. Выбирается только при постановке.
  const [needsReview, setNeedsReview] = useState(() => task?.needsReview !== false);
  // «Каждый сдаёт сам» (миграция 0067, задача №111): у работы вроде «каждый
  // изучает книгу» отчёта за всех не бывает, и кнопки «Сделал: всю задачу»
  // тогда нет. Выбирается при постановке и только при нескольких
  // исполнителях — у одного «свою часть» и «всю задачу» одно и то же.
  const [eachOwn, setEachOwn] = useState(() => task?.eachOwn === true);
  // Зависимость (миграция 0061): своя копия, как у срока, — снимок задачи у
  // открытого окна не обновляется.
  const [blockedBy, setBlockedBy] = useState(() => task?.blockedBy || "");
  const waitChoices = waitOptions.filter((o) => o.id !== task?.id);
  // Выбор нужен, только когда работу делает кто-то кроме меня: свою задачу
  // и так закрывает собственный отчёт (closeIfEveryoneReported).
  const othersExecute = pending.some((p) => p.role === "executor" && p.assigneeId !== myAssigneeId);
  const severalExecute = pending.filter((p) => p.role === "executor").length > 1;
  // Принудительное закрытие — один запрос за раз (тот же приём, что busy
  // у приёмки в TeamCompact).
  const [closingBusy, setClosingBusy] = useState(false);

  // Ход работы — словами, тем же счётом, что видят на доске кружки людей:
  // кто взялся, кто закончил. «0 из 6», считавшее одни отчёты, Кирилл
  // принял за поломку (13.10.2026, задача №111: пятеро приняли).
  const progressNow = taskProgress(participants);
  const tookNow = participants.filter((p) => p.role === "executor" && (p.acceptedAt || p.doneAt)).length;
  const progressText = progressNow.total
    ? [
        `Взяли ${tookNow} из ${progressNow.total}`,
        `закончили ${progressNow.doneCount}`,
        ...(progressNow.declined.length ? [`не может ${progressNow.declined.length}`] : []),
      ].join(" · ")
    : "";

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
  // Закрытая задача — только просмотр (14.10.2026, «запрети любые
  // изменения или дополнения уже закрытых событий. Только просмотр»).
  // Ни срока, ни состава, ни описания, ни «Отложить» и «Удалить», и
  // обсуждение без поля ввода. Остаются «Повторить» (это новая задача, а
  // не правка этой) и у постановщика «Открыть заново» — единственный выход
  // обратно, событие с причиной и строкой в хронике.
  const closed = !!task && isClosed(task);
  // Кто я — чтобы чек-лист знал, какие шаги мои (их убрать может автор).
  const checklistUserId = useWorkspaceRole().userId;
  const editable = canEdit && !closed;

  // «Отложить» — кнопкой в строке срока, самой правой (20.10.2026: «часики
  // отложенных задач переделать в кнопку в строке „Срок“, кнопку чуть
  // выделить от остальных»). Раньше это был значок в шапке рядом с
  // корзиной: по виду — ещё одно «удалить», по смыслу — ничего не
  // говорящие часы. Отложить — это решение о сроке («не сейчас, а тогда»),
  // и место ему рядом со сроком. Подпись меняется на день возвращения,
  // чтобы видно было, что задача отложена и до какого числа.
  const [snoozeNow, setSnoozeNow] = useState(() => task?.snoozedUntil || "");
  const snoozedNow = isSnoozed(snoozeNow, todayStr());
  const snoozeButton =
    task && editable ? (
      <button
        type="button"
        className={"snooze-btn" + (snoozedNow ? " on" : "")}
        id="snoozeTaskBtn"
        title={
          snoozedNow
            ? `Отложена до ${snoozeDay(snoozeNow)} — нажмите, чтобы вернуть сейчас или выбрать другой день`
            : "Убрать с вашей доски до выбранного дня — в этот день задача вернётся, и бот напомнит"
        }
        onClick={() =>
          void (async () => {
            const choice = await chooseSnooze(ask, { snoozedUntil: snoozeNow, deadline: selfDeadline }, todayStr());
            if (choice === null) return;
            setSnoozeNow(choice);
            patchTask({ snoozedUntil: choice });
            // Отложенная уходит с доски — окно над ней закрывается, как
            // после приёмки. Возвращённая остаётся открытой: с ней и будут
            // работать.
            if (choice) onClose();
          })()
        }
      >
        <Icon name="clock" size={15} />
        <span>{snoozedNow ? `До ${snoozeDay(snoozeNow)}` : "Отложить"}</span>
      </button>
    ) : null;

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

  // Имя в поле «Исполнитель» заведённой задачи — короткая запись того же
  // состава, и её читают бот, сводки и триггер миграции 0024. Пока была
  // кнопка «Сохранить», имя переписывалось при сохранении; теперь состав
  // меняется сразу — и имя вместе с ним, иначе в задаче остаётся записан
  // человек, которого с неё сняли («две правды об одном факте»).
  function syncAssigneeName(nextExecutors: string[]) {
    if (!task) return;
    const current = form.assignee.trim();
    if (current && nextExecutors.includes(current)) return;
    const next = nextExecutors[0] || "";
    if (next === current) return;
    setForm((f) => ({ ...f, assignee: next }));
    patchTask({ assignee: next });
  }

  function addToTask(person: PersonOption, role: TaskParticipantRole) {
    void onAddParticipant(person.id, role);
    if (role === "executor") {
      const names = participants.filter((p) => p.role === "executor").map((p) => p.name);
      syncAssigneeName([...names, person.name]);
    }
  }

  function setRoleOnTask(p: Participant, role: TaskParticipantRole) {
    onSetParticipantRole(p.id, role);
    const names = participants
      .filter((x) => (x.id === p.id ? role === "executor" : x.role === "executor"))
      .map((x) => x.name);
    syncAssigneeName(names);
  }

  function removeFromTask(p: Participant) {
    onRemoveParticipant(p.id);
    syncAssigneeName(participants.filter((x) => x.id !== p.id && x.role === "executor").map((x) => x.name));
  }

  // «Принудительное закрытие» — бывшее «Закрыть волевым решением». Слова
  // Кирилла 13.10.2026: «перенеси в правый верхний угол… переименуй в
  // „принудительное закрытие“… при принудительном закрытии обязательный
  // комментарий. Принудительно закрыть может только постановщик задачи!
  // Соответственно отображаться должно только у него». Маршрут то же самое
  // и проверяет (api/workspace/review, force_close — только автор).
  async function handleForceClose() {
    if (!task || closingBusy) return;
    const answer = await ask.askWithFiles({
      title: "Принудительное закрытие",
      question: "Почему закрываете задачу?",
      note: "Комментарий обязателен: его увидят все на задаче, и только он объясняет, почему она закрыта без обычной приёмки.",
      multiline: true,
      okText: "Закрыть задачу",
      quick: QUICK_FORCE_CLOSE,
      required: "Без комментария закрыть нельзя — напишите причину.",
    });
    if (answer === null || closingBusy) return;
    setClosingBusy(true);
    try {
      await answerWithFiles({ kind: "task", id: task.id }, answer.files, "Документы к принудительному закрытию", () => onForceCloseWork(answer.text.trim()));
    } finally {
      setClosingBusy(false);
    }
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

  function focusField(id: string) {
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: "center" });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus();
  }

  async function save() {
    if (saving || committedRef.current) return;
    const title = form.title.trim();
    if (!title) {
      // Ответ на «не заполнено» — само поле: форма к этому моменту обычно
      // прокручена вниз, к «Сохранить», и без этого фокус уходил в никуда,
      // а пустого названия даже не было видно (QA 06.10.2026).
      void ask.say({ title: "Название не заполнено", question: "Укажите название задачи." }).then(() => focusField("fTitle"));
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
      }).then(() => focusField("fPeople"));
      return;
    }
    // Срок обязателен — у любой задачи, своей тоже (14.10.2026: «запрети
    // ставить задачи без срока даже самому себе, срок обязателен»). Без
    // срока не работают ни напоминания, ни ступени просрочки, ни «скоро
    // срок» в сводке, и проверка 13.10 нашла двадцать таких открытых задач,
    // о которых трекер не говорил ни разу. Исключение одно — повторяющаяся
    // задача: её срок каждый раз считает сам повтор.
    if (!form.deadline && form.recur === "none") {
      void ask.say({
        title: "Нужен срок",
        question: "Укажите, до какого дня задача должна быть сделана.",
        note: "Кнопки «Сегодня», «Завтра», «Через неделю» — рядом с календарём.",
      }).then(() => focusField("fDeadline"));
      return;
    }
    // Срок в прошлом — только тот, что уже стоял (задача просрочена и её
    // открыли). Новый срок раньше сегодняшнего дня не ставится: календарь
    // такие дни гасит, а эта проверка ловит полночь, пережитую открытой
    // формой.
    if (form.deadline && form.deadline < isoInDays(0) && form.deadline !== (task?.deadline || "")) {
      void ask.say({ title: "Этот день уже прошёл", question: "Срок не может быть в прошлом — выберите сегодня или позже." }).then(() => focusField("fDeadline"));
      return;
    }
    // Имя в задаче — первый исполнитель из набранного состава. Поле
    // «Исполнитель» исчезло, но колонка осталась: её читают карточка,
    // фильтр, бот и сводки, и триггер миграции 0024 заводит по ней строку
    // участия, если её почему-то нет.
    const primary = pending.find((p) => p.role === "executor");
    // Проверки пройдены — дальше задача уходит. Флаг ставится ДО первого
    // await: загрузка файлов длится секунды, и нажатие в это время
    // завело бы вторую задачу с теми же файлами.
    committedRef.current = true;
    const next: Task = {
      // Сначала сохранённая запись целиком, поверх — поля формы. Всё, чего
      // в форме нет (автор, дата постановки), иначе молча терялось: Игорь
      // Витковский нажал «Сохранить» в своей задаче, у неё пропал
      // createdBy, и с этой секунды трекер считал её задачей владельца —
      // карточка подписалась «Кирилл Кучеренко → Игорь Витковский», рядом
      // встала вторая, настоящая, а синхронизация руководителя («пишу только
      // своё») перестала отправлять правку в базу вовсе. Отзыв 25.09.2026:
      // «нажимаешь Сохранить — появляется дубль».
      ...task,
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
      recurWorkday: (form.recur === "monthly" || form.recur === "yearly") && form.recurWorkday,
      lastCompletedOn: task?.lastCompletedOn ?? "",
      manualOrder: task?.manualOrder ?? null,
      completedAt: task?.completedAt ?? "",
      needsReview: task ? task.needsReview !== false : !othersExecute || needsReview,
      eachOwn: task ? task.eachOwn === true : severalExecute && eachOwn,
      blockedBy: task ? task.blockedBy || "" : blockedBy,
    };
    // Файлы к описанию новой задачи — в корзину ДО сохранения: задача,
    // чей обещанный макет не загрузился, ушла бы исполнителю без него, и
    // он прочёл бы её как полную (то же правило, что у отчёта с актом).
    if (!task && newDescFiles.length) {
      setSaving(true);
      try {
        next.descFiles = await uploadTaskFiles(next.id, newDescFiles, "desc");
      } catch (e) {
        // Задача не ушла — окно остаётся, и нажать «Сохранить» снова можно.
        committedRef.current = false;
        setSaving(false);
        setNewDescError(humanError(e, "Не получилось загрузить файл — задача не сохранена"));
        return;
      }
      setSaving(false);
    }
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
      {/* С 14.10.2026 срок обязателен (см. save): «Нужен срок» у метки
          говорит об этом заранее, а не только в момент отказа. У
          повторяющейся задачи срок считает сам повтор. */}
      <label>
        Срок
        {form.recur === "none" && (
          <span className={"field-req" + (form.deadline ? " met" : "")}>
            {form.deadline ? "Срок стоит" : "Нужен срок"}
          </span>
        )}
      </label>
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
          // Без «убрать срок»: срок обязателен (14.10.2026).
          // Срок в прошлом не ставится (07.10.2026, «запрети создавать
          // любые события в прошедшем времени»): задача, рождённая
          // просроченной, с первой секунды шлёт ступени просрочки.
          minDate={isoInDays(0)}
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
        {/* Отдельного крестика «убрать срок» больше нет — слова Кирилла
            23.09.2026: «пусть там так же работает, ты просто выбираешь
            другой вариант и оно само меняется. Крестик — лишний». Выбор
            другой кнопки или дня в календаре по-прежнему меняет срок сам. */}
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
        {/* Шапка заведённой задачи — номер, название в рамке, действия и ×
            (ItemModalHead). У новой задачи — та же шапка без рамки: × в углу
            вместо «Отмены» внизу, как у всех окон (14.10.2026). */}
        {isEditing && task ? (
          <ItemModalHead
            kicker={task.number != null ? `#${task.number}` : "Задача"}
            kickerTitle={task.number != null ? `Задача №${task.number}` : undefined}
            title={form.title || "Задача"}
            titleId="modalTitle"
            closeId="cancelBtn"
            onClose={onClose}
            actions={
              <>
                {/* Принудительное закрытие — только у постановщика, только
                    у открытой задачи и не у своей: свою закрывают галочкой. */}
                {canEdit && !selfTask && stage !== "done" && task.status !== "done" && (
                  <button
                    type="button"
                    className="item-head-btn force-close"
                    id="forceCloseBtn"
                    title="Принудительное закрытие"
                    disabled={closingBusy}
                    onClick={() => void handleForceClose()}
                  >
                    {/* На телефоне шапка в одну строку не вмещает два слова —
                        там остаётся «Закрыть»: × на телефоне нет (его место
                        у стрелки «назад»), так что спутать не с чем. */}
                    <span className="fc-long">Принудительное закрытие</span>
                    <span className="fc-short">Закрыть</span>
                  </button>
                )}
                {task.status === "done" && onRepeat && (
                  <button
                    type="button"
                    className="item-head-btn"
                    id="repeatTaskBtn"
                    title="Завести такую же задачу с новым сроком"
                    onClick={() =>
                      onRepeat({
                        title: task.title,
                        desc: task.desc,
                        sectionId: task.sectionId,
                        people: participants.map((p) => ({ name: p.name, role: p.role })),
                        // У старых задач строк участия может не быть — тогда
                        // исполнитель берётся из поля самой задачи.
                        assignee: participants.length ? undefined : task.assignee,
                      })
                    }
                  >
                    Повторить
                  </button>
                )}
                {/* Удаление — значком в шапке: Кирилл попросил убрать
                    «Удалить / Сохранить / Отмена» снизу, а удалить задачу
                    всё равно иногда нужно. Спрашивается и отменяется
                    уведомлением, как всё разрушительное. */}
                {editable && (
                  <button
                    type="button"
                    className="item-head-icon danger"
                    id="deleteTaskBtn"
                    title="Удалить задачу"
                    aria-label="Удалить задачу"
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
                    <Icon name="trash" size={17} />
                  </button>
                )}
              </>
            }
          />
        ) : (
          <ItemModalHead plain title="Новая задача" titleId="modalTitle" closeId="cancelBtn" onClose={onClose} />
        )}
        <input type="hidden" id="taskId" value={task?.id ?? ""} readOnly />

        {/* Заведённая задача разворачивается в два столбца на десктопе:
            слева всё функциональное (решения, сводка, описание, результат),
            справа — обсуждение. Слова Кирилла 22.09.2026: «хочу, чтобы в
            версии для ПК чат был правее функционального окна задачи».
            На телефоне и на узком окне .modal-split ничего не значит
            (display:contents) и всё идёт одной колонкой. */}
        {task ? (
          <div className="modal-split">
            <div className="modal-main">
              {/* Решение постановщика — первым: принять или вернуть,
                  согласиться на перенос или нет (24.09.2026). */}
              {canEdit && !selfTask && (
                <TeamCompact
                  taskId={task.id}
                  participants={participants}
                  approvalState={task.approvalState || "open"}
                  approvalComment={task.approvalComment}
                  onApproveWork={onApproveWork}
                  onReturnWork={onReturnWork}
                  onWaitForAll={onWaitForAll}
                  onReopenWork={onReopenWork}
                  onCloseUnfulfilled={onForceCloseWork}
                  closed={closed}
                  onAcceptReschedule={onAcceptReschedule}
                  onRejectReschedule={onRejectReschedule}
                />
              )}

              {/* То, чего ждут ОТ ВАС: ради этого карточку и открывают,
                  когда задачу поручили вам. */}
              {myPart && !selfTask && (
                <TaskAnswer
                  me={myPart}
                  closed={task.status === "done" || task.approvalState === "accepted"}
                  onReview={stage === "awaiting_review"}
                  // «Каждый сдаёт сам» — развилки «свою часть / всю задачу» нет.
                  othersPending={task.eachOwn ? 0 : progressNow.pendingNames.length - (myPart.role === "executor" && !myPart.doneAt && !myPart.declinedAt ? 1 : 0)}
                  deadline={task.deadline || ""}
                  returnedComment={task.approvalState === "returned" ? task.approvalComment || "" : ""}
                  onAccept={() => onAcceptWork?.(myPart.id) ?? Promise.resolve()}
                  onReport={(comment, files, whole) => onReportWork?.(myPart.id, comment, files, whole) ?? Promise.resolve()}
                  onDecline={(reason, files) =>
                    answerWithFiles({ kind: "task", id: task.id }, files, "Документы к отказу", () => onDeclineWork?.(myPart.id, reason) ?? Promise.resolve())
                  }
                  onAskReschedule={(to, reason, files) =>
                    answerWithFiles({ kind: "task", id: task.id }, files, "Документы к просьбе о переносе", () => onAskReschedule?.(myPart.id, to, reason) ?? Promise.resolve())
                  }
                  onAnswered={onClose}
                />
              )}

              {/* Своя задача: вместо ответов — срок, и только он. Двигается
                  сразу, без просьбы и решения: просить и решать здесь один и
                  тот же человек. Закрывают её галочкой на карточке. */}
              {selfTask && !closed && (
                <div className="field self-deadline" id="selfDeadline">
                  <label>Срок</label>
                  <div className="deadline-row">
                    <MiniCalendar popover id="selfDeadlineCal" value={selfDeadline} onChange={moveOwnDeadline} minDate={isoInDays(0)} />
                    {QUICK_DEADLINES.map((q) => (
                      <button
                        key={q.label}
                        type="button"
                        className={"participant-chip" + (selfDeadline && selfDeadline === isoInDays(q.days) ? " selected" : "")}
                        onClick={() => moveOwnDeadline(isoInDays(q.days))}
                      >
                        {q.label}
                      </button>
                    ))}
                    {snoozeButton}
                  </div>
                </div>
              )}

              {/* Главное о задаче — одним блоком: кто поставил и когда, срок
                  и ход работы, а ниже — люди по ролям, каждый со своим
                  этапом, и «+» (13.10.2026). Бейдж стадии — в правом верхнем
                  углу (24.09.2026). */}
              <ItemFacts
                id="taskFacts"
                badge={stage && !selfTask && <span className={"tp-stage tp-stage-" + stage}>{STAGE_LABEL[stage]}</span>}
                rows={[
                  {
                    left: {
                      label: "Постановщик",
                      value: (
                        <>
                          {authorLabel(task.createdBy, authors, availablePeople.map((p) => p.name))}
                          {isArchived(authorLabel(task.createdBy, authors, availablePeople.map((p) => p.name))) && <ArchivedMark />}
                        </>
                      ),
                    },
                    right: { label: "Дата постановки", value: whenCreated(task.createdAt || "") || "—", muted: !task.createdAt },
                  },
                  {
                    left: {
                      label: "Крайний срок",
                      // Сколько раз переносили и какой был первым (миграция
                      // 0058) — тут же, мелко: это половина ответа на «почему
                      // она до сих пор не сделана».
                      value: selfDeadline ? (
                        <>
                          {fmtDate(selfDeadline)}
                          {!!task.deadlineMoves && (
                            <span className="fact-note" id="deadlineMoves">
                              {" "}
                              · переносили {task.deadlineMoves}×{task.firstDeadline ? `, изначально ${fmtDate(task.firstDeadline)}` : ""}
                            </span>
                          )}
                        </>
                      ) : (
                        "Без срока"
                      ),
                      muted: !selfDeadline,
                    },
                    // У своей задачи «Отложить» стоит в строке «Срок» над
                    // сводкой; у поручения строки срока нет, и кнопка
                    // встаёт в конец строки «Крайний срок», самой правой.
                    extra: selfTask ? undefined : snoozeButton,
                    // «Без приёмки» стояло припиской к номеру в шапке; шапка
                    // теперь в одну строку (20.10.2026), и приписка
                    // переехала к ходу работы — это его свойство: чем он
                    // кончится.
                    right:
                      selfTask || !progressText
                        ? undefined
                        : {
                            label: "Ход работы",
                            value: (
                              <>
                                {/* Одной строкой (20.10.2026: последняя цифра
                                    «закончили 3» переносилась на вторую строку
                                    и читалась отдельно от слов). */}
                                <span className="progress-line">{progressText}</span>
                                {task.needsReview === false && <span className="fact-note progress-note">без приёмки — закроется отчётом</span>}
                                {task.eachOwn && <span className="fact-note progress-note">каждый сдаёт сам</span>}
                              </>
                            ),
                          },
                  },
                ]}
                footer={
                  <TaskPeople
                    taskId={task.id}
                    participants={participants}
                    availablePeople={availablePeople}
                    canEdit={editable}
                    selfTask={selfTask}
                    closed={closed || stage === "done"}
                    onAdd={addToTask}
                    onSetRole={setRoleOnTask}
                    onRemove={removeFromTask}
                    onReturnOne={onReturnOne}
                    onAddPerson={isAdmin ? () => void handleAddAssignee() : undefined}
                    meId={myAssigneeId}
                  />
                }
              />

              {/* Описание — своим блоком под сводкой (13.10.2026), с
                  документами; правит постановщик, пишется само. */}
              <TaskDescription
                taskId={task.id}
                desc={descNow.desc}
                files={descNow.files}
                canEdit={editable}
                onSave={(desc, files) => {
                  setDescNow({ desc, files });
                  patchTask({ desc, descFiles: files });
                }}
              />

              {/* Чек-лист — под описанием (миграция 0059): описание говорит,
                  ЧТО сделать, шаги — из чего это состоит. Ведут постановщик,
                  исполнители и соисполнители. */}
              <TaskWaitsFor
                value={blockedBy}
                options={waitChoices}
                editable={canEdit && !closed}
                onChange={(id) => {
                  setBlockedBy(id);
                  patchTask({ blockedBy: id });
                }}
              />

              <TaskChecklist
                taskId={task.id}
                canWork={canEdit || myPart?.role === "executor" || myPart?.role === "coexecutor"}
                isAuthor={canEdit}
                myUserId={checklistUserId}
                closed={closed}
              />

              {/* Результат — то, ради чего приёмку вообще открывают. */}
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
                          обсуждении: на приёмке акт нужен ровно в эту секунду. */}
                      <ResultFiles files={r.doneFiles || []} />
                    </div>
                  ))}
                </div>
              )}

              {!canEdit && !closed && (
                <div className="task-card-note">
                  Эту задачу поставил не вы — менять её может только постановщик. Написать в обсуждение можно.
                </div>
              )}
            </div>

            <div className="modal-chat-pane">
              {/* Тегнуть можно всех, кто на задаче, — и постановщика тоже:
                  в строках участия его нет, а писать ему как раз чаще всех
                  (07.10.2026, тот же вопрос про встречу). */}
              <ItemChat
                kind="task"
                itemId={task.id}
                readOnly={closed}
                mentionCandidates={mentionPeople(
                  [authorLabel(task.createdBy, authors, availablePeople.map((p) => p.name)), ...participants.map((p) => p.name)].filter(
                    (n) => !isArchived(n),
                  ),
                )}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="field">
              <label>Название задачи</label>
              <div className="input-with-mic">
                <AutoGrowTextarea
                  id="fTitle"
                  placeholder="Что нужно сделать"
                  value={form.title}
                  onChange={(text) => setForm((f) => ({ ...f, title: text }))}
                  singleLine
                  // Название из мысли — черновик, его дописывают: курсор
                  // сразу в конце текста (07.10.2026, «с возможностью
                  // дополнения или редактирования»).
                  focusAtEnd={!task && !!prefill?.fromIdeaId}
                />
                <AddButton id="titleAddBtn" title="Создать задачу" disabled={saving || !form.title.trim()} onClick={() => void save()} />
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
                  <AutoGrowTextarea id="fDesc" placeholder="Детали, контекст…" value={form.desc} onChange={(text) => setForm((f) => ({ ...f, desc: text }))} minRows={2} maxRows={12} />
                  {/* «+» здесь нет нарочно: описание новой задачи пишется
                      вместе с ней, своей записи у него нет, и «+» у этого
                      поля заводил задачу целиком — то есть читался как
                      «сохранить описание», а делал другое (21.10.2026). */}
                  <MicButton value={form.desc} onChange={(text) => setForm((f) => ({ ...f, desc: text }))} title="Надиктовать описание" />
                </div>
                {/* Документы к описанию — техзадание, макет, скриншот
                    (13.10.2026, «при создании задачи в блок описание добавь
                    возможность добавлять файлы»). Грузятся при сохранении. */}
                <AttachFiles files={newDescFiles} onChange={setNewDescFiles} onError={setNewDescError} />
                {newDescError && <div className="ms-answer-error">{newDescError}</div>}
              </div>
            ) : (
              <button type="button" className="btn btn-small field-add" id="addDescBtn" onClick={() => setDescOpen(true)}>
                + описание и файлы
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

        {/* Повторение — только у новой
            задачи. У заведённой их правка ни до кого не доходит: человеку
            уже отправили задачу такой, какая она есть, и менять её у себя в
            окне значит развести то, что записано, и то, что он видел. То же
            решение, что у назначенной встречи, и по той же причине. */}
        {!isEditing && (
        <>
        {/* Поля «Раздел» здесь больше нет (14.10.2026, «убери из создания
            задачи выбор отдела, это на мой взгляд лишнее»). Раздел у задачи
            остаётся: его ставит кнопка раздела над доской (SectionTabs) —
            задача заводится уже в нём и с его людьми.
            Заводят и удаляют разделы в окне «Разделы». */}
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

        {/* Поля нет, пока ждать нечего: лишнее поле в форме — лишнее. */}
        {waitChoices.length > 0 && <TaskWaitsFor value={blockedBy} options={waitChoices} editable onChange={setBlockedBy} />}

        {othersExecute && (
          <div className="field" id="fReviewField">
            <label>Приёмка</label>
            <ChipChoice
              id="fReview"
              value={needsReview ? "yes" : "no"}
              onSelect={(v) => setNeedsReview(v === "yes")}
              options={[
                { value: "yes", label: "Принимаю сам" },
                { value: "no", label: "Без приёмки", title: "Когда все исполнители отчитаются, задача закроется сама" },
              ]}
            />
          </div>
        )}

        {severalExecute && (
          <div className="field" id="fEachOwnField">
            <label>Как сдают</label>
            <ChipChoice
              id="fEachOwn"
              value={eachOwn ? "own" : "any"}
              onSelect={(v) => setEachOwn(v === "own")}
              options={[
                { value: "any", label: "Можно сдать за всех", title: "Исполнитель может сдать задачу целиком, не дожидаясь остальных" },
                { value: "own", label: "Каждый сдаёт сам", title: "Работа у каждого своя: сдать задачу за других нельзя" },
              ]}
            />
          </div>
        )}

        <div className="field">
          <label>Повторение задачи</label>
          {/* «По будням» — отдельной кнопкой, рядом с «Каждый день». Отзыв
              Витовского 25.09.2026: «если ставишь задачу с повторением, пусть
              система учитывает выходные». Умела она это давно — недельный
              повтор с кнопкой «Будни», — но спрятанным на второй ступени, и
              «каждый день» выбирали вместо него. Внутри это тот же недельный
              повтор пн–пт: второго вида повтора ради одной кнопки не нужно. */}
          <ChipChoice
            id="fRecur"
            value={form.recur === "weekly" && isWorkweek ? "workdays" : form.recur}
            options={[
              { value: "none", label: "Не повторяется" },
              { value: "workdays", label: "По будням" },
              { value: "daily", label: "Каждый день" },
              { value: "weekly", label: "Каждую неделю" },
              { value: "monthly", label: "Каждый месяц" },
              { value: "yearly", label: "Каждый год" },
            ]}
            onSelect={(v) =>
              setForm((f) =>
                v === "workdays"
                  ? { ...f, recur: "weekly" as RecurKind, recurWeekdays: ["1", "2", "3", "4", "5"], recurWeekday: "1" }
                  : { ...f, recur: v as RecurKind },
              )
            }
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
          {/* Предложение Котова 15.10.2026: «ставишь на 1-е число, и в
              какой-то месяц выпадет на сб. или вс. … галка — рабочие дни».
              Число, выпавшее на выходной или праздник, встаёт на ближайший
              рабочий день (lib/recurShift). Только у месячного и годового:
              у недельного дни выбирают руками. */}
          <div
            className={"recur-config" + (form.recur === "monthly" || form.recur === "yearly" ? " open" : "")}
            id="recurWorkdayRow"
          >
            <ChipChoice
              id="fRecurWorkday"
              value={form.recurWorkday ? "yes" : "no"}
              options={[
                { value: "no", label: "В любой день" },
                {
                  value: "yes",
                  label: "Только в рабочий",
                  title: "Выпало на выходной или праздник — задача встанет на ближайший рабочий день",
                },
              ]}
              onSelect={(v) => setForm((f) => ({ ...f, recurWorkday: v === "yes" }))}
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

        {/* Кнопки внизу — только у НОВОЙ задачи: это форма, и её сохраняют
            или отменяют. У заведённой их нет вовсе (13.10.2026, «любые
            изменения… должны автоматически в ней сохраняться, то есть
            кнопки „Удалить, Сохранить, Отмена“ вроде как не должны быть
            нужны»): всё, что в ней меняется, пишется сразу, закрывает её ×
            в шапке или Esc, а удаление и «Отложить» живут в шапке. */}
        {!isEditing && (
          <div className="modal-actions">
            <div className="left" />
            <div className="left">
              {canEdit && (
                <button className="btn btn-primary" id="saveTaskBtn" disabled={saving} onClick={() => void save()}>
                  {saving ? "Загружаю файлы…" : "Сохранить"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
