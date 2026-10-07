"use client";

// Port of the meeting modal from trackerMarkup.ts + openMeetingModal()/
// meetingSaveBtn/deleteMeetingBtn/setMeetingStatus/performReschedule in
// legacy-tracker.js. Kept on the same element ids for e2e-pattern reuse.
import { useEffect, useState } from "react";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import ItemChat, { mentionPeople } from "./ItemChat";
import { postProposal } from "@/hooks/useItemComments";
import MeetingAnswer from "./MeetingAnswer";
import type { MeetingVoteRow } from "@/hooks/useMeetingVotes";
import type { Meeting, MeetingPrefill, MeetingRecur, MeetingStatus } from "@/types/tracker";
import { RECUR_LABELS } from "@/lib/meetingRepeatLabels";
import { useColleagues } from "@/hooks/useColleagues";
import { awayMark, awayPhrase, isAwayOn } from "@/lib/away";
import { fmtDate } from "@/lib/taskDisplay";
import { isSelfAssignee, sanitizeAssigneeList } from "@/lib/trackerRows";
import { withoutSelfMark } from "@/lib/actorName";
import { uid } from "@/lib/uid";
import MicButton from "./MicButton";
import MiniCalendar from "./MiniCalendar";
import AutoGrowTextarea from "./AutoGrowTextarea";
import AttachFiles from "./AttachFiles";
import { answerWithFiles } from "@/lib/answerFiles";
import { humanError } from "@/lib/humanError";
import { useAsk } from "@/components/Ask";
import { sortNames } from "@/lib/peopleOrder";
import Modal from "./Modal";
import Icon from "./Icon";
import ChipChoice from "./ChipChoice";
import ItemFacts from "./ItemFacts";
import ExpandableText from "./ExpandableText";
import MeetingAgenda from "./MeetingAgenda";
import type { AgendaItem } from "@/hooks/useMeetingAgenda";
import { WORKDAY_SLOTS, busyPeople, defaultMeetingStart, startsInPast } from "@/lib/meetingTime";
import { SEARCH_FROM, matchesPerson } from "@/lib/personSearch";
import { useAuthors } from "@/hooks/useAuthors";
import { authorLabel, authorRawName } from "@/lib/authorName";
import { isCurrent, voteTally, withOrganizer } from "@/lib/meetingVotes";
import { awaitsRecap } from "@/lib/calendarLogic";
import { markTaskCommentsRead } from "@/hooks/useUnreadTaskComments";

// 09:00–18:00 in half-hour steps: the working day, one tap per slot.
const TIME_SLOTS = WORKDAY_SLOTS;

// Дни, на которые встречи назначают чаще всего, — теми же тремя кнопками,
// что и срок задачи (см. TaskModal.QUICK_DEADLINES).
const QUICK_DAYS = [
  { label: "Сегодня", days: 0 },
  { label: "Завтра", days: 1 },
  { label: "Через неделю", days: 7 },
];

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Когда встречу назначили — числом и временем, как в карточке задачи.
function whenCreated(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
  onAgendaTask,
  canEdit = true,
  canConfirm = false,
  isMove,
  dayMeetings = [],
  myVote = null,
  votes = [],
  onAnswer,
  onAcceptProposal,
}: {
  meeting: Meeting | null;
  prefill?: MeetingPrefill;
  assignees: string[];
  onSave: (m: Meeting) => void;
  // true — встречу отменили (причина названа), false — передумали.
  onDelete: () => boolean | Promise<boolean>;
  onClose: () => void;
  onSetStatus: (meeting: Meeting, status: MeetingStatus, result: string) => void;
  // Единственный путь изменить «когда» и «кого» у назначенной встречи.
  // Открывает форму НОВОЙ встречи с тем же составом; старая закроется как
  // перенесённая, когда новая будет сохранена (см. MeetingsPanel).
  onReschedule?: () => void;
  // Пункт повестки → форма новой задачи (MeetingAgenda).
  onAgendaTask?: (item: AgendaItem) => void;
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
  // Ответы всех, кого позвали: «буду», «не смогу с причиной», «опоздаю»,
  // молчание. Показываются прямо у имён в сводке — Кирилл просил видеть
  // состав «с заполненными реакциями по факту отклика участников».
  votes?: MeetingVoteRow[];
  onAnswer?: (response: "yes" | "no" | "late", reason: string) => Promise<void>;
  // Организатор переносит встречу на время, предложенное участником
  // (кнопка на самом предложении в обсуждении).
  onAcceptProposal?: (proposal: { date: string; time: string; reason: string; by: string }) => void;
}) {
  const isEditing = !!meeting;
  // Новой встрече без заданного времени — первый ещё не начавшийся слот, а
  // не «10:00» вслепую (см. defaultMeetingStart): иначе в пять вечера форма
  // предлагала сегодняшнее утро, и встреча молча создавалась в прошлом.
  const [start] = useState(() => {
    const asked =
      meeting || prefill?.time
        ? { date: meeting?.date ?? prefill?.date ?? "", time: meeting?.time || prefill?.time || "10:00" }
        : defaultMeetingStart(prefill?.date ?? "", TIME_SLOTS);
    // Новая встреча, предложенная на прошедшее время (задача, брошенная на
    // вчерашний день календаря; перенос «на +1 день» встречи недельной
    // давности), начинается с ближайшего слота впереди: прошлое форма всё
    // равно не примет.
    return !meeting && startsInPast(asked.date, asked.time) ? defaultMeetingStart("", TIME_SLOTS) : asked;
  });
  const [date, setDateRaw] = useState(start.date);
  const [title, setTitle] = useState(meeting?.title ?? prefill?.title ?? "");
  const [time, setTime] = useState(start.time);
  // Выбор дня тянет за собой время, если оно на этот день уже прошло:
  // «Сегодня» в шесть вечера при выбранных 10:00 — время, которое форма не
  // примет, и человек не должен гадать, почему не сохраняется. Время
  // сдвигается на ближайший слот впереди.
  function setDate(next: string) {
    setDateRaw(next);
    if (startsInPast(next, time)) setTime(defaultMeetingStart(next, TIME_SLOTS).time);
  }
  const [participants, setParticipants] = useState<string[]>(sanitizeAssigneeList(meeting?.participants ?? prefill?.participants ?? []));
  // Кто я в этом пространстве — нужно ровно для одного: не предлагать
  // позвать самого себя (см. selectableAssignees). Ответ прошлого запуска
  // хук отдаёт сразу, сеть поправляет его фоном.
  const identity = useWorkspaceRole();
  // Кто из логинов какой человек: по этому имени и подписана строка
  // «Назначил». У владельца created_by пуст, и это значит «он сам» — см.
  // lib/authorName.
  const authors = useAuthors();
  const ask = useAsk();
  // Открыли встречу — её обсуждение прочитано на этом устройстве (значок на
  // карточке гаснет, см. useUnreadTaskComments).
  useEffect(() => {
    if (meeting?.id) markTaskCommentsRead(meeting.id, "meeting");
  }, [meeting?.id]);
  const [result, setResult] = useState(meeting?.result ?? "");
  // Документы к итогу — протокол, фотография доски, подписанный акт
  // (06.10.2026: документ прикладывается к любому итогу). Ложатся в
  // обсуждение встречи, см. lib/answerFiles.
  const [recapFiles, setRecapFiles] = useState<File[]>([]);
  const [recapError, setRecapError] = useState("");
  const [recapBusy, setRecapBusy] = useState(false);
  // Выбора «Назначаю / Предлагаю время» в форме больше нет.
  //
  // Слова Кирилла 21.09.2026: «параметр „как собираем“ убираем. все
  // встречи должны работать путём назначения. и если у кого-то не
  // получается присутствовать, организатор встречи принимает решение,
  // переговорив с человеком, который не может, на другое время».
  //
  // То есть предложение было лишним шагом к тому же результату: встреча
  // всё равно назначается, а несогласие решается разговором и переносом,
  // а не состоянием в базе. Сам статус `proposed` в базе остаётся —
  // предложить встречу по-прежнему можно из мессенджера, и уже
  // предложенные никуда не делись (для них ниже есть кнопка «Назначить»).
  // Новая встреча из трекера всегда назначенная.
  // Полчаса или час. Слова Кирилла 20.09.2026: «удобный способ выбирать
  // 30 минут или час» — и это не украшение формы, а то, из чего считается
  // занятость людей: час встречи вынимает из их дня час, а не точку.
  const [durationMin, setDurationMin] = useState<number>(meeting?.durationMin || 30);
  // Повтор (миграция 0046): каждое повторение — отдельная встреча, следующую
  // заводит крон в день текущей и зовёт тех же людей (lib/meetingRepeat).
  const [recur, setRecur] = useState<MeetingRecur>(meeting?.recur ?? prefill?.recur ?? "none");
  // Кого в день встречи не будет (миграция 0047) — по самой дате встречи,
  // а не по сегодняшней: отпуск до пятницы встрече в понедельник не мешает.
  const { colleagues: team } = useColleagues();
  const awayOnDay = (name: string) => {
    const c = team.find((p) => p.name === name);
    return c && isAwayOn(c.awayUntil, date) ? c : null;
  };

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
  //
  // Заняты ли ВЫБРАННЫЕ люди в это время. Чужая занятость, никого из
  // приглашённых не касающаяся, — не повод гасить кнопку: в трекере
  // четырнадцать человек, и при таком правиле свободных слотов не
  // осталось бы вовсе. Считается весь отрезок встречи, а не её начало:
  // часовая в 15:30 заходит на чужие 16:00 (lib/meetingTime.busyPeople).
  const busyNamesAt = (slotTime: string, minutes: number = durationMin): string[] =>
    busyPeople(dayMeetings, { date, time: slotTime, durationMin: minutes, people: participants, ignore: [meeting?.id] });

  // Кто из позванных занят в ВЫБРАННОЕ время — красным прямо на имени.
  //
  // Отзыв Витовского 25.09.2026: «ставлю тебя и Макарова на 10:00, система
  // подсказывает, что у Макарова уже встреча… пусть красным подсвечивает;
  // переносишь на 11:00 — все имена синие, значит всё ок». Штриховка на
  // кнопке времени говорила это только тому, кто навёл на неё мышь, и
  // только про другие слоты — про выбранный она молчала.
  const busyNow = new Set(time ? busyNamesAt(time) : []);
  const [peopleQuery, setPeopleQuery] = useState("");

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

  // Кнопки «Отправить» в карточке встречи нет по той же причине, по
  // которой её нет в карточке задачи (см. TaskModal): встречу получают те,
  // кого на неё позвали, в момент сохранения, а вторая кнопка рядом с
  // «Сохранить» предлагала послать её кому-то ЕЩЁ — вопрос, которого в
  // карточке никто не задаёт.

  // После «не заполнено» человек должен оказаться в поле, которое пустует, —
  // а не в прокрученной вниз форме с фокусом в никуда.
  function focusTitle() {
    const el = document.getElementById("mTitle");
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  }

  async function save() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      await ask.say({ title: "Название не заполнено", question: "Укажите название встречи." });
      focusTitle();
      return;
    }
    if (!date) {
      void ask.say({ title: "Дата не заполнена", question: "Укажите дату встречи." });
      return;
    }
    // Встреча в прошлом — запрет, а не вопрос. До 07.10.2026 здесь было
    // «всё равно назначить?» ради записи задним числом, и встреча на 10:00,
    // назначенная в 10:26, уходила людям приглашением на то, что уже
    // началось. Слова Кирилла: «запрети возможность создавать любые события
    // в прошедшем времени». Прошедшие дни и слоты в форме и так погашены —
    // эта проверка ловит то, что прошло, пока форма была открыта.
    if (!isEditing && startsInPast(date, time)) {
      await ask.say({
        title: "Это время уже прошло",
        question: `${fmtDate(date)}, ${time} — уже в прошлом. Выберите время впереди.`,
      });
      return;
    }
    // Пересечение с другой встречей кого-то из позванных — тоже запрет.
    // Занятые слоты в сетке и так погашены; это ловит то, что сетка не
    // закрывает: человека добавили ПОСЛЕ выбора времени, или его встречу
    // назначили, пока форма была открыта. Назначенной встрече проверка не
    // нужна — её время и состав здесь не меняются.
    if (!isEditing && busyNow.size > 0) {
      await ask.say({
        title: "Это время уже занято",
        question: `В ${time} уже на другой встрече: ${[...busyNow].map(withoutSelfMark).join(", ")}. Выберите свободное время или уберите ${busyNow.size > 1 ? "их" : "его"} из состава.`,
      });
      return;
    }
    onSave({
      // Сначала сохранённая запись целиком, поверх — поля формы. Всё, чего
      // в форме нет (автор, дата постановки), иначе молча терялось: Игорь
      // Витковский нажал «Сохранить» в своей задаче (у встречи то же самое), у неё пропал
      // createdBy, и с этой секунды трекер считал её задачей владельца —
      // карточка подписалась «Кирилл Кучеренко → Игорь Витковский», рядом
      // встала вторая, настоящая, а синхронизация руководителя («пишу только
      // своё») перестала отправлять правку в базу вовсе. Отзыв 25.09.2026:
      // «нажимаешь Сохранить — появляется дубль».
      ...meeting,
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
      // У назначенной встречи правило меняется только кнопкой «Больше не
      // повторять» — она пишет сама, мимо формы.
      recur: isEditing ? meeting.recur ?? "none" : recur,
      title: isEditing ? meeting.title : trimmedTitle,
      participants: isEditing ? meeting.participants : sanitizeAssigneeList(participants),
      // Новая встреча — назначенная, всегда (см. комментарий про «Как
      // собираем» выше). У сохранённой статус остаётся её собственный.
      status: meeting?.status ?? "planned",
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

  async function setStatus(status: MeetingStatus) {
    if (!meeting || recapBusy) return;
    setRecapBusy(true);
    setRecapError("");
    try {
      // Файлы загружаются ДО смены статуса: итог, чей протокол не
      // загрузился, не закрывает встречу — иначе окно закрылось бы, а
      // документ пропал молча.
      await answerWithFiles({ kind: "meeting", id: meeting.id }, status === "planned" ? [] : recapFiles, "Документы к итогу встречи", () =>
        onSetStatus(meeting, status, result),
      );
      onClose();
    } catch (e) {
      setRecapError(humanError(e, "Не получилось приложить документы"));
    } finally {
      setRecapBusy(false);
    }
  }

  const resolved = isEditing && meeting.status && meeting.status !== "planned" && meeting.status !== "proposed";
  const proposed = isEditing && meeting.status === "proposed";

  // Кто собрал и когда — для сводки сохранённой встречи.
  const organizer = authorLabel(meeting?.createdBy, authors, assignees);
  const createdLabel = whenCreated(meeting?.createdAt);

  // Отклик человека — значком у его имени. «Буду», «опоздаю», «не смогу» и
  // молчание — четыре разных ответа, и три из них раньше в карточке не были
  // видны вовсе: состав перечислялся строкой через запятую.
  //
  // Ответ, данный до переноса, ответом не считается (isCurrent): человек,
  // который мог во вторник, о четверге не сказал ничего.
  const round = meeting?.voteRound || 1;
  // Организатор в составе — «буду» без нажатия (lib/meetingVotes,
  // withOrganizer): он её и собрал.
  const counted = withOrganizer(votes, participants, authorRawName(meeting?.createdBy, authors, participants), round);
  function voteOf(name: string): { state: string; mark: string; title: string } {
    const row = counted.find((v) => v.name === name);
    if (!row || row.response === "none" || !isCurrent(row, round)) {
      // «Видел, но молчит» — со вторым договариваются, первому напоминают
      // (миграция 0042, отзыв Витовского 25.09.2026).
      return {
        state: "none",
        mark: "•",
        title: row?.seenAt ? `${withoutSelfMark(name)} открывал встречу, но пока не ответил` : `${withoutSelfMark(name)} — пока не ответил`,
      };
    }
    if (row.response === "no") {
      // Причина — в обсуждении встречи, а не в подсказке (07.10.2026).
      return { state: "no", mark: "✕", title: `${withoutSelfMark(name)} не сможет — причина в обсуждении` };
    }
    if (row.late) return { state: "late", mark: "🕐", title: `${withoutSelfMark(name)} будет, но опоздает` };
    return { state: "yes", mark: "✓", title: `${withoutSelfMark(name)} будет` };
  }

  // «3 из 5» — короткий ответ на «собралась ли встреча». Считается по тем,
  // кого спрашивают (наблюдатели не в счёт, см. mustVote; организатор — в
  // счёт и всегда «буду», см. withOrganizer).
  const tally = voteTally(counted, round);
  const answeredLabel = tally.expected
    ? `${tally.answered} из ${tally.expected}` + (tally.no.length ? ` · не смогут: ${tally.no.length}` : "")
    : "ответов не ждём";

  // Решения организатора — назначить предложенную встречу и записать
  // итог. Слова Кирилла 24.09.2026: блоки, призывающие к действию, «во
  // встречах тоже должны быть выше» — сразу под названием, а не под
  // сводкой. Но итог поднимается наверх только когда его уже МОЖНО дать
  // (встреча прошла — awaitsRecap) или он уже дан: у будущей встречи
  // пустое поле итога над сводкой отодвинуло бы вниз то, ради чего её
  // открывают, — когда и кто. Разметка одна, место — одно из двух.
  const decisionBlocks = meeting ? (
    <>
          {/* Предложенную встречу назначает тот, кто её собрал: право
              занимать чужое время у него ровно такое же, как у всех. До
              этого она видна, по ней можно ответить, но ни в календарь,
              ни в напоминания она не попадает. */}
          {proposed && canConfirm && (
            <div className="field proposed-row">
              <div className="proposed-text">
                Пока это предложение: время ни у кого не занято и напоминаний нет. Когда ответят все, встреча
                назначится сама — или назначьте сейчас, не дожидаясь.
              </div>
              <button type="button" className="btn btn-small btn-primary" id="confirmMeetingBtn" onClick={() => void setStatus("planned")}>
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

          {canEdit && (
            <div className="field outcome-field" id="outcomeField">
              <label>Итог встречи</label>
              <div className={"outcome-badge" + (resolved ? ` show ${meeting.status}` : "")} id="outcomeBadge">
                {resolved ? outcomeLabel(meeting.status) + (meeting.movedToDate ? " · перенесено на " + fmtDate(meeting.movedToDate) : "") : ""}
              </div>
              {/* Закрытая встреча — договорённость, а не черновик: у
                  неё уже есть исход, и решать его заново, не открыв
                  сначала «Вернуть в план», значит незаметно поменять
                  то, о чём уже сказали участникам. Слова Кирилла
                  23.09.2026: «закрытые или вычеркнутые события — не
                  подлежат изменениям и доступны только к просмотру».
                  Поэтому итог здесь — текст, а не поле, и кнопок
                  «Успешно» / «Без результата» нет вовсе: единственный
                  санкционированный путь назад — «Вернуть в план». */}
              {resolved ? (
                <>
                  {result && <ExpandableText text={result} className="task-card-desc" />}
                  <div className="outcome-actions">
                    <button type="button" className="btn btn-small" id="reopenMeetingBtn" onClick={() => void setStatus("planned")}>
                      <Icon name="reset" size={15} /> Вернуть в план
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="input-with-mic">
                    {/* Enter завершает встречу успешно — по правилу Кирилла
                        21.09.2026 «любые заполнения результатов или итогов
                        должны закрываться нажатием Enter после заполнения,
                        везде». */}
                    <AutoGrowTextarea
                      id="mResult"
                      minRows={2}
                      placeholder="Кратко: что решили, что дальше…"
                      value={result}
                      onChange={setResult}
                      onEnter={() => void setStatus("success")}
                    />
                    <MicButton value={result} onChange={setResult} title="Надиктовать итог" />
                  </div>
                  <div className="field-hint">Enter — завершить успешно, Shift+Enter — новая строка.</div>
                  <AttachFiles files={recapFiles} onChange={setRecapFiles} onError={setRecapError} />
                  {recapError && <div className="ms-answer-error">{recapError}</div>}
                  <div className="outcome-actions">
                    <button type="button" className="btn btn-small outcome-btn-success" id="markSuccessBtn" disabled={recapBusy} onClick={() => void setStatus("success")}>
                      <Icon name="check" size={15} /> Успешно
                    </button>
                    <button type="button" className="btn btn-small outcome-btn-noresult" id="markNoResultBtn" disabled={recapBusy} onClick={() => void setStatus("no_result")}>
                      <Icon name="ban" size={15} /> Без результата
                    </button>
                  </div>
                </>
              )}
              {/* Блока «Перенести следующий этап» здесь больше нет.
                  У встречи есть кнопка ⇢ в списке, и она спрашивает дату
                  и время тем же окном (useDateTimeConfirm). */}
            </div>
          )}
    </>
  ) : null;
  const decisionsFirst =
    !!meeting && ((proposed && canConfirm) || (canEdit && (!!resolved || awaitsRecap(meeting))));

  return (
    <Modal id="meetingOverlay" onClose={onClose} dismissOnBackdrop={false}>
      <div className={"modal" + (meeting ? " has-chat" : "")}>
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
        {/* Назначенная встреча разворачивается в два столбца на десктопе —
            слева сводка, итог и приёмка, справа обсуждение, каждый со
            своей прокруткой. Слова Кирилла 22.09.2026: «расширение окна и
            чтобы чат был в правой части так же касается и уже созданных и
            предстоящих встреч». На телефоне и на узком окне .modal-split
            ничего не значит (display:contents) — колонка одна, как раньше. */}
        {meeting ? (
          <div className="modal-split">
            <div className="modal-main">
              {myVote && onAnswer && !resolved && (
                <MeetingAnswer
                  me={myVote}
                  onAnswer={(response, reason, files) =>
                    answerWithFiles({ kind: "meeting", id: myVote.meetingId }, files, "Документы к ответу «не смогу»", () => onAnswer(response, reason))
                  }
                  // Прошедшую встречу переносить поздно — предлагать нечего.
                  onPropose={awaitsRecap(meeting) ? undefined : (date, time, reason) => postProposal(meeting.id, date, time, reason)}
                />
              )}

              {/* Сводка встречи — той же формы, что сводка задачи.
                  Слова Кирилла 21.09.2026: «окно созданной встречи должно
                  быть однотипным с окном созданной задачи…». Ровно это и
                  стоит ниже, тем же компонентом, что и у задачи (ItemFacts). */}
              <div className="meeting-fact-title">{title}</div>
              {decisionsFirst && decisionBlocks}
              <ItemFacts
                id="meetingFacts"
                rows={[
                  {
                    left: { label: "Назначил", value: organizer },
                    right: { label: "Дата создания", value: createdLabel || "—", muted: !createdLabel },
                  },
                  {
                    left: {
                      label: "Когда",
                      value: (
                        <>
                          {fmtDate(date)}
                          {time ? `, ${time}` : ""}
                          <span className="fact-note"> · {meeting.durationMin === 60 ? "1 час" : "30 минут"}</span>
                          {meeting.recur && meeting.recur !== "none" && (
                            <span className="fact-note meeting-recur-note">
                              {" "}
                              · {RECUR_LABELS[meeting.recur].toLowerCase()}
                              {canEdit && (
                                <button
                                  type="button"
                                  className="link-btn"
                                  id="meetingStopRepeat"
                                  title="Эта встреча останется, следующих не будет"
                                  onClick={() => onSave({ ...meeting, recur: "none" })}
                                >
                                  больше не повторять
                                </button>
                              )}
                            </span>
                          )}
                        </>
                      ),
                    },
                    right: {
                      label: "Ответили",
                      value: answeredLabel,
                      muted: !participants.length,
                    },
                  },
                  {
                    wide: {
                      label: "Участники",
                      value: participants.length ? (
                        <span className="fact-people">
                          {participants.map((name) => {
                            const vote = voteOf(name);
                            return (
                              <span className={"fact-person vote-" + vote.state} key={name} title={vote.title}>
                                <span className="fact-person-mark">{vote.mark}</span>
                                {withoutSelfMark(name)}
                              </span>
                            );
                          })}
                        </span>
                      ) : (
                        "никого не позвали"
                      ),
                      muted: !participants.length,
                    },
                  },
                ]}
              />
              {/* Путь к изменению — здесь же, а не «где-то в списке». Кнопка
                  открывает форму новой встречи с тем же составом: перенести и
                  заодно поправить, кого зовём, — одно действие. Только у
                  организатора (canEdit): панель и так не передаёт
                  onReschedule участнику, а проверка здесь — чтобы новый
                  вход в окно не вернул кнопку молча. Это главное действие
                  организатора над назначенной встречей, поэтому кнопка —
                  заливкой во всю ширину, а не серой строкой под сводкой:
                  07.10.2026 «она не заметна визуально». */}
              {onReschedule && canEdit && !resolved && (
                <button type="button" className="btn btn-primary meeting-move-btn" id="meetingMoveBtn" onClick={onReschedule}>
                  <Icon name="calendar" size={17} />
                  <span>Перенести встречу</span>
                  <span className="meeting-move-sub">время или состав</span>
                </button>
              )}

              {/* Повестка — под сводкой и кнопкой переноса, над итогом: до
                  встречи её дописывают, на встрече по ней идут. */}
              <MeetingAgenda meetingId={meeting.id} isOrganizer={canEdit} closed={!!resolved} onTask={onAgendaTask} />

              {!decisionsFirst && decisionBlocks}
            </div>

            <div className="modal-chat-pane">
              {/* Тегнуть можно каждого, кто в этой встрече, — и того, кто
                  её назначил. 07.10.2026: «почему мне не даёт выбрать Игоря
                  Витковского, ведь он такой же участник встречи, не смотря
                  на то что в позиции назначителя». Организатор в списке
                  позванных не стоит (он идёт по определению), и упоминания
                  брали только этот список. */}
              <ItemChat
                kind="meeting"
                itemId={meeting.id}
                mentionCandidates={mentionPeople([organizer, ...participants])}
                onAcceptProposal={canEdit && !resolved ? onAcceptProposal : undefined}
              />
            </div>
          </div>
        ) : (
          <>
            {/* Название — первым полем.
                Слова Кирилла 21.09.2026: «при создании встречи окно
                названия встречи должно быть выше всех, потом идёт дата,
                время, участники, сколько займёт». Он прав и по порядку
                мысли: встречу сперва называют («планёрка по опту»), а уже
                потом решают, когда она и кто на ней. Календарь, стоявший
                первым, спрашивал о дате того, кто ещё не сказал, о чём
                собираемся. */}
            <div className="field">
              <label>Название встречи</label>
              <div className="input-with-mic">
                <AutoGrowTextarea id="mTitle" placeholder="Например: Совещание по опту" value={title} onChange={setTitle} singleLine />
                <MicButton value={title} onChange={setTitle} title="Надиктовать название" />
              </div>
            </div>

            <div className="field">
              <label>Дата</label>
              {/* Сразу календарём, а не полем «дд.мм.гггг»: встречу назначают на
                  день недели («в четверг»), а не на число, и сетка месяца
                  отвечает на этот вопрос сама.

                  Рядом — три кнопки самых частых дней, ровно как у срока
                  задачи. Слова Кирилла 21.09.2026: «в поле дата так же
                  добавь после ручного выбора даты быстрые кнопки „сегодня“,
                  „завтра“, „через неделю“». Половина встреч назначается на
                  завтра, и открывать ради этого сетку месяца — лишнее
                  движение. */}
              <div className="deadline-row">
                <MiniCalendar popover id="mDate" value={date} onChange={setDate} minDate={isoInDays(0)} />
                {QUICK_DAYS.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    className={"participant-chip" + (date && date === isoInDays(q.days) ? " selected" : "")}
                    onClick={() => setDate(isoInDays(q.days))}
                  >
                    {q.label}
                  </button>
                ))}
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
                  // Прошедшее сегодня время заперто (07.10.2026, «запрети
                  // создавать события в прошедшем времени»).
                  const past = startsInPast(date, slot);
                  return (
                  <button
                    key={slot}
                    type="button"
                    // Занятое время тоже заперто, с тем же 07.10.2026. До
                    // этого оно было только помечено — с доводом «планёрку
                    // иногда ставят поверх другой», — и Кирилл получил две
                    // встречи на одно время с одним человеком: «запрети
                    // такую возможность». Человек не может быть в двух
                    // местах, а «та подождёт» решается переносом той.
                    // Заперт весь отрезок: при часе гаснет и 15:30, если в
                    // 16:00 уже встреча. Выбранное, ставшее занятым (позвали
                    // человека после выбора времени), остаётся видно красным,
                    // и сохранить его нельзя — см. save().
                    className={"time-slot" + (time === slot ? " selected" : "") + (busy.length ? " busy" : "") + (past ? " past" : "")}
                    title={past ? "Это время сегодня уже прошло" : busy.length ? "Заняты: " + busy.map(withoutSelfMark).join(", ") : undefined}
                    aria-label={busy.length ? `${slot} — заняты: ${busy.map(withoutSelfMark).join(", ")}` : undefined}
                    disabled={past || busy.length > 0}
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
              {selectableAssignees.length >= SEARCH_FROM && (
                <input
                  className="people-search"
                  type="search"
                  placeholder="Найти человека…"
                  value={peopleQuery}
                  onChange={(e) => setPeopleQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter не сохраняет встречу из поля поиска; один найденный —
                    // выбирается им.
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const found = selectableAssignees.filter((n) => !participants.includes(n) && matchesPerson(n, peopleQuery));
                    if (found.length === 1) {
                      toggleParticipant(found[0]);
                      setPeopleQuery("");
                    }
                  }}
                  aria-label="Найти человека"
                />
              )}
              <div className="participant-grid" id="mParticipants">
                {selectableAssignees
                  .filter((name) => participants.includes(name) || matchesPerson(name, peopleQuery))
                  .map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={
                      "participant-chip" +
                      (participants.includes(name) ? " selected" : "") +
                      (participants.includes(name) && busyNow.has(name) ? " busy-now" : "")
                    }
                    title={participants.includes(name) && busyNow.has(name) ? `${withoutSelfMark(name)} в ${time} уже на другой встрече` : undefined}
                    onClick={() => toggleParticipant(name)}
                  >
                    {/* Метка «(я)» написана для одного человека, а читают
                        список все: в базу уходит полное имя строки, на
                        экран — имя. */}
                    {withoutSelfMark(name)}
                    {awayOnDay(name) && <span className="chip-away"> · {awayMark(awayOnDay(name)!.awayUntil)}</span>}
                  </button>
                ))}
              </div>
              {participants.some((n) => awayOnDay(n)) && (
                <div className="field-hint away-hint">
                  {participants
                    .filter((n) => awayOnDay(n))
                    .map((n) => `${withoutSelfMark(n)} ${awayPhrase(awayOnDay(n)!.awayKind, awayOnDay(n)!.awayUntil)}`)
                    .join("; ")}
                  {participants.filter((n) => awayOnDay(n)).length > 1 ? " — в день встречи их не будет." : " — в день встречи его не будет."}
                </div>
              )}
              {busyNow.size > 0 && (
                <div className="field-hint busy-now-hint">
                  В {time} уже на другой встрече: {[...busyNow].map(withoutSelfMark).join(", ")}. Так сохранить нельзя —
                  выберите свободное время или уберите {busyNow.size > 1 ? "их" : "его"} из состава.
                </div>
              )}
            </div>

            <div className="field">
              <label>Сколько займёт</label>
              <ChipChoice
                id="mDuration"
                value={durationMin === 60 ? "60" : "30"}
                onSelect={(v) => setDurationMin(v === "60" ? 60 : 30)}
                // Час, заходящий на чужую встречу кого-то из позванных, —
                // то же пересечение, что и занятый слот, и гаснет так же.
                // Получас не гасится никогда: он начало часа, и если занят
                // он, погашено само время.
                options={[
                  { value: "30", label: "30 минут" },
                  (() => {
                    const clash = durationMin !== 60 && time ? busyNamesAt(time, 60) : [];
                    return clash.length
                      ? { value: "60" as const, label: "1 час", disabled: true, title: `Второй получас занят: ${clash.map(withoutSelfMark).join(", ")}` }
                      : { value: "60" as const, label: "1 час" };
                  })(),
                ]}
              />
              <div className="field-hint">
                {durationMin === 60
                  ? "Час выпадает из дня у всех, кого зовёте: другие встречи на это время им уже не поставят незаметно."
                  : "Полчаса — обычная планёрка. Занятое время видно остальным при выборе."}
              </div>
            </div>

            <div className="field">
              <label>Повторять</label>
              <ChipChoice
                id="mRecur"
                value={recur}
                onSelect={(v) => setRecur(v as MeetingRecur)}
                options={(Object.keys(RECUR_LABELS) as MeetingRecur[]).map((value) => ({ value, label: RECUR_LABELS[value] }))}
              />
              {recur !== "none" && (
                <div className="field-hint">
                  Следующая встреча заведётся сама в день этой — с тем же временем и составом, и людям придёт приглашение.
                </div>
              )}
            </div>

          </>
        )}

        <div className="modal-actions">
          <div className="left">
            {isEditing && canEdit && (
              <button
                className="btn btn-danger-ghost"
                id="deleteMeetingBtn"
                onClick={() =>
                  void (async () => {
                    // Причину отмены спрашивает сам обработчик (MeetingsPanel):
                    // окно закрывается, только если встречу действительно
                    // отменили.
                    if (await onDelete()) onClose();
                  })()
                }
              >
                Отменить встречу
              </button>
            )}
          </div>
          <div className="left">
            <button className="btn" id="meetingCancelBtn" onClick={onClose}>
              Отмена
            </button>
            {canEdit && (
              <button className="btn btn-primary" id="meetingSaveBtn" onClick={() => void save()}>
                Сохранить
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
