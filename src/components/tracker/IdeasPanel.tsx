"use client";

import dynamic from "next/dynamic";
import { loadDoneListModal, loadIdeaReviewModal, loadSentIdeasModal } from "@/lib/lazyWindows";

import { useState } from "react";
import type { Idea } from "@/types/tracker";
import { doneIdeasNewestFirst, sortIdeasForList } from "@/lib/ideaDisplay";
import { isMine } from "@/lib/ownership";
import { formatIdeaCreatedAt, isSelfAssignee } from "@/lib/trackerRows";
import { uid } from "@/lib/uid";
import IdeaItem from "./IdeaItem";
import Icon from "./Icon";
import type { useToasts } from "@/hooks/useToasts";
import AutoGrowTextarea from "./AutoGrowTextarea";
import MicButton from "./MicButton";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ideasToReview, isReviewDay, reviewWeek } from "@/lib/ideaReview";
import IncomingIdeas from "./IncomingIdeas";
import SharedIdeaItem from "./SharedIdeaItem";
import { prefetchIdeaInbox, useIdeaRecipients } from "@/hooks/useIdeaRecipients";
import { authorLabel } from "@/lib/authorName";
import { incomingFor, sentAwayIds, sentToByIdea, sharedWithMe, type IdeaRecipientRow } from "@/lib/ideaRecipients";
import { postOrQueue } from "@/lib/outbox";

// Окна — отдельными кусками, подгружаются фоном после первого кадра
// (lib/lazyWindows: почему и как).
const DoneListModal = dynamic(loadDoneListModal, { ssr: false });
const IdeaReviewModal = dynamic(loadIdeaReviewModal, { ssr: false });
const SentIdeasModal = dynamic(loadSentIdeasModal, { ssr: false });

// «Оставить» помнится до конца недели в этом браузере (см. lib/ideaReview).
// Хранилище может не открыться (приватное окно) — тогда разбор просто
// забывает оставленное, и это не поломка.
function readKept(week: string): Set<string> {
  try {
    const raw = localStorage.getItem("ideaReviewKept");
    const saved = raw ? (JSON.parse(raw) as { week: string; ids: string[] }) : null;
    return new Set(saved && saved.week === week ? saved.ids : []);
  } catch {
    return new Set();
  }
}
function writeKept(week: string, ids: Set<string>) {
  try {
    localStorage.setItem("ideaReviewKept", JSON.stringify({ week, ids: [...ids] }));
  } catch {
    /* см. readKept */
  }
}

// Рассылку мыслей спрашиваем сразу, как только код трекера загружен, —
// параллельно с задачами, а не после того, как панель нарисована
// (см. prefetchIdeaInbox).
prefetchIdeaInbox();

// Присланная мысль, которую превращают в задачу или встречу в обычной
// форме. Форма живёт в NewTracker, ответ — здесь: `done` зовётся, когда
// форма СОХРАНЕНА, с id новой задачи или встречи.
export type IncomingConversion = {
  kind: "task" | "meeting";
  ideaId: string;
  title: string;
  // Имена строк ровно как в списке людей (с «(я)» у владельца): ими
  // заполняются поля исполнителя и состава встречи.
  me: string;
  author: string;
  done: (itemId: string) => void;
};

function plural(n: number): string {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return "мысль";
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return "мысли";
  return "мыслей";
}

export default function IdeasPanel({
  myUserId = "",
  ideas,
  highlightId,
  actions,
  toasts,
  onConvertToTask,
  onConvertToMeeting,
  onIncomingConvert,
}: {
  // Свой auth-id: чужую мысль прислали тебе, а не отдали.
  myUserId?: string;
  ideas: Idea[];
  actions: {
    saveIdea: (idea: Idea) => void;
    deleteIdea: (id: string) => void;
    restoreIdea: (idea: Idea) => void;
  };
  toasts: ReturnType<typeof useToasts>;
  // Conversions live in the parent, which owns both ideas and tasks — the
  // same handlers the drop targets call, so a button and a drag end up
  // doing exactly one thing, undo toast included.
  onConvertToTask: (ideaId: string) => void;
  onConvertToMeeting: (ideaId: string) => void;
  onIncomingConvert?: (req: IncomingConversion) => void;
  // The idea the global search just jumped to, briefly flashed.
  highlightId?: string | null;
}) {
  const isMobile = useIsMobile();
  const [text, setText] = useState("");
  // Окно с вычеркнутыми мыслями.
  const [doneOpen, setDoneOpen] = useState(false);
  // Окно с отправленными мыслями.
  const [sentOpen, setSentOpen] = useState(false);

  // Рассылка мыслей: автору — кому ушла его мысль, получателю — что
  // прислали ему (lib/ideaRecipients). Один хук на панель, и всё нужное
  // он приносит сам — с кэшем прошлого запуска, чтобы блок появлялся
  // вместе с мыслями, а не через секунду после них.
  const recipients = useIdeaRecipients();
  const sentTo = sentToByIdea(recipients.rows, recipients.names);
  const incoming = incomingFor(recipients.rows, recipients.myAssigneeId, myUserId);
  const shared = sharedWithMe(recipients.rows, recipients.myAssigneeId, myUserId);
  const people = Object.values(recipients.names);
  // «Отправить» отдаёт мысль: из рабочего списка она уходит в окно
  // «Отправленные» (решение Кирилла 23.09.2026, миграция 0051). Поделённая
  // остаётся на месте.
  const sentAway = sentAwayIds(recipients.rows);
  const own = ideas.filter((i) => !sentAway.has(i.id));
  // Свежеотправленные сверху — по времени последней отправки.
  const lastSent: Record<string, string> = {};
  for (const r of recipients.rows) if (sentAway.has(r.ideaId) && (lastSent[r.ideaId] || "") < r.createdAt) lastSent[r.ideaId] = r.createdAt;
  const sentList = ideas
    .filter((i) => sentAway.has(i.id) && !i.done)
    .sort((a, b) => (lastSent[b.id] || "").localeCompare(lastSent[a.id] || ""));

  function answered(row: IdeaRecipientRow, answer: "taken" | "seen" | "failed") {
    if (answer === "failed") void recipients.reload();
    else if (answer === "taken") recipients.markLocally(row.id, { convertedTaskId: "pending" });
    else recipients.markLocally(row.id, { seenAt: new Date().toISOString() });
  }

  // «Сохранить в мысли»: копия в мои мысли. Не через addText: тот очищает
  // поле ввода, а в нём может лежать недописанная своя мысль.
  function keepCopy(row: IdeaRecipientRow) {
    actions.saveIdea({ id: uid(), text: row.idea?.text || "", important: false, done: false, createdAt: formatIdeaCreatedAt(new Date()), doneAt: "" });
  }

  // «В работу» / «Встреча» у присланной и поделённой. Автор — строка по его
  // членству, а пустой created_by — владелец, то есть строка «(я)».
  function convertIncoming(row: IdeaRecipientRow, kind: "task" | "meeting") {
    if (!onIncomingConvert) return;
    const createdBy = row.idea?.createdBy || "";
    const author = createdBy ? recipients.authors[createdBy] || "" : people.find(isSelfAssignee) || "";
    onIncomingConvert({
      kind,
      ideaId: row.ideaId,
      title: row.idea?.text || "",
      me: recipients.names[recipients.myAssigneeId] || "",
      author,
      done: (itemId) => {
        answered(row, kind === "task" ? "taken" : "seen");
        // Без связи отметка ждёт сети в очереди (lib/outbox), а не
        // объявляется неудачей: задача или встреча уже заведена.
        postOrQueue(
          "/api/workspace/report",
          kind === "task"
            ? { action: "idea_task", recipientId: row.id, taskId: itemId }
            : { action: "idea_meeting", recipientId: row.id, meetingId: itemId },
          "Не получилось",
        ).catch(() => answered(row, "failed"));
      },
    });
  }

  // В панели — только живые мысли. Вычеркнутые смотрят в отдельном окне
  // по иконке с галочкой: перечёркнутые строки посреди списка мыслей —
  // это шум там, где ищут, что записать дальше.
  const visible = sortIdeasForList(own, false);
  // Свежевычеркнутые сверху — тем же правилом, что у доски и встреч.
  const done = doneIdeasNewestFirst(ideas);

  // Разбор недели. «Сейчас» берётся один раз на монтирование: панель живёт
  // день-два, и строка, появившаяся посреди пятницы без перезагрузки, —
  // не потеря.
  const [now] = useState(() => new Date());
  const week = reviewWeek(now);
  const [kept, setKept] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : readKept(week)));
  const [reviewTotal, setReviewTotal] = useState(0);
  // Отправленную не разбирают: её отдали, решение теперь за получателем.
  const queue = ideasToReview(own, now, kept, (idea) => isMine(idea, myUserId));
  const showReview = isReviewDay(now) && queue.length > 0;


  function keep(idea: Idea) {
    const next = new Set(kept);
    next.add(idea.id);
    setKept(next);
    writeKept(week, next);
  }

  function addText(raw: string) {
    const v = raw.trim();
    if (!v) return;
    actions.saveIdea({ id: uid(), text: v, important: false, done: false, createdAt: formatIdeaCreatedAt(new Date()), doneAt: "" });
    setText("");
  }
  function add() {
    addText(text);
  }

  function deleteIdea(idea: Idea) {
    actions.deleteIdea(idea.id);
    toasts.showToast("Идея удалена", idea.text.slice(0, 60), () => actions.restoreIdea(idea));
  }

  return (
    <div className="panel dash-panel" id="ideasPanel" data-panel-id="ideasPanel">
      {/* На телефоне этой строки нет: название повторяет подпись вкладки,
          число — цифру на ней, а вычеркнутые мысли с телефона не
          показываются вовсе («завершённые в мобильной версии поскрывай»,
          20.09.2026). Первым на экране стоит поле, в которое пишут. */}
      {!isMobile && (
        <div className="dash-panel-head">
          <div className="panel-title">
            Идеи и мысли <span className={"count" + (visible.length + shared.length === 0 ? " zero" : "")}>{visible.length + shared.length}</span>
          </div>
          {sentList.length > 0 && (
            <button
              type="button"
              className="panel-done-btn panel-sent-btn"
              id="ideasSentBtn"
              title="Отправленные мысли — кому ушли и что ответили"
              onClick={() => setSentOpen(true)}
            >
              <Icon name="send" size={14} />
              <span className="panel-done-count">{sentList.length}</span>
            </button>
          )}
          {done.length > 0 && (
            <button
              type="button"
              className="panel-done-btn"
              id="ideasDoneBtn"
              title="Вычеркнутые мысли"
              onClick={() => setDoneOpen(true)}
            >
              <Icon name="check" size={14} />
              <span className="panel-done-count">{done.length}</span>
            </button>
          )}
        </div>
      )}
      <div className="idea-add">
        <AutoGrowTextarea
          id="ideaInput"
          // Без эмодзи: значок микрофона стоит тут же, справа от поля, — и
          // нарисованный, а не в виде наклейки посреди подсказки, где он к
          // тому же ломал её на две строки.
          placeholder="Новая мысль"
          value={text}
          onChange={setText}
          singleLine
          onEnter={add}
        />
        {/* Кнопка вернулась 23.09.2026 по прямой просьбе Кирилла — «там где
            идеи все же нужен маленький „+“ для добавления новых». Набранная
            мысль по-прежнему сохраняется по Enter, надиктованная — сама; эта
            кнопка просто даёт третий, явный способ отправить то, что уже
            напечатано, тем же движением, что и везде в трекере. */}
        <button
          type="button"
          className="field-mic-btn field-add-btn idea-add-btn"
          title="Добавить мысль"
          disabled={!text.trim()}
          onClick={add}
        >
          <Icon name="plus" size={16} />
        </button>
        <MicButton value={text} onChange={setText} onDone={(finalText) => addText(finalText)} title="Надиктовать мысль" />
      </div>
      <IncomingIdeas
        rows={incoming}
        authorOf={(createdBy) => authorLabel(createdBy || undefined, recipients.authors, people)}
        onAnswered={answered}
        onToTask={(row) => convertIncoming(row, "task")}
        onToMeeting={(row) => convertIncoming(row, "meeting")}
        onKeep={keepCopy}
      />
      {showReview && !reviewTotal && (
        <button type="button" className="idea-review-strip" id="ideaReviewBtn" onClick={() => setReviewTotal(queue.length)}>
          {queue.length} {plural(queue.length)} без движения больше недели — разобрать
        </button>
      )}
      <div id="ideaList">
        {/* Поделённые со мной — сверху своих: они новые для меня, и ответа
            не требуют, поэтому стоят в списке, а не в блоке «Прислали вам». */}
        {shared.map((row) => (
          <SharedIdeaItem
            key={row.id}
            row={row}
            from={authorLabel(row.idea?.createdBy || undefined, recipients.authors, people)}
            onAnswered={answered}
            onKeep={keepCopy}
            onToTask={(r) => convertIncoming(r, "task")}
            onToMeeting={(r) => convertIncoming(r, "meeting")}
          />
        ))}
        {visible.length === 0 ? (
          shared.length === 0 && (
            <div className="empty">{own.length === 0 ? "Пока пусто — запишите первую мысль" : "Нет активных мыслей"}</div>
          )
        ) : (
          visible.map((idea) => (
            <IdeaItem
              key={idea.id}
              idea={idea}
              // Чужая мысль: её прислали тебе, а не отдали. Править и
              // удалять её вправе автор — база откажет молча.
              canEdit={isMine(idea, myUserId)}
              onToggleDone={() => actions.saveIdea({ ...idea, done: !idea.done, doneAt: idea.done ? "" : new Date().toISOString() })}
              onToggleImportant={() => actions.saveIdea({ ...idea, important: !idea.important })}
              onEditText={(newText) => actions.saveIdea({ ...idea, text: newText })}
              onDelete={() => deleteIdea(idea)}
              onConvertToTask={() => onConvertToTask(idea.id)}
              onConvertToMeeting={() => onConvertToMeeting(idea.id)}
              highlighted={highlightId === idea.id}
              sentTo={sentTo[idea.id]}
            />
          ))
        )}
      </div>

      {/* Превращение закрывает разбор: дальше открывается форма задачи или
          встречи, и окно разбора под ней было бы вторым уровнем, о котором
          человек уже забыл. Вернуться к остальным — та же строка. */}
      {reviewTotal > 0 && (
        <IdeaReviewModal
          queue={queue}
          total={reviewTotal}
          onTask={(idea) => {
            setReviewTotal(0);
            onConvertToTask(idea.id);
          }}
          onMeeting={(idea) => {
            setReviewTotal(0);
            onConvertToMeeting(idea.id);
          }}
          onKeep={keep}
          onClose={() => setReviewTotal(0)}
        />
      )}

      {sentOpen && <SentIdeasModal ideas={sentList} sentTo={sentTo} onClose={() => setSentOpen(false)} />}

      {doneOpen && (
        <DoneListModal
          title="Вычеркнутые мысли"
          empty="Вычеркнутых мыслей нет."
          restoreLabel="Вернуть"
          items={done.map((idea) => ({
            id: idea.id,
            title: idea.text,
            // Дата — та, по которой список отсортирован, то есть КОГДА
            // вычеркнули. Показывать дату записи под списком «свежие
            // сверху» значит показывать числа вразнобой: мысль, записанная
            // в августе и закрытая вчера, стояла бы наверху с августовским
            // числом, и порядок читался бы как случайный. У мыслей,
            // вычеркнутых до появления колонки done_at, даты закрытия нет —
            // там остаётся дата записи, как было.
            when: idea.doneAt ? formatIdeaCreatedAt(idea.doneAt) : idea.createdAt,
            onRestore: isMine(idea, myUserId) ? () => actions.saveIdea({ ...idea, done: false, doneAt: "" }) : undefined,
          }))}
          onClose={() => setDoneOpen(false)}
        />
      )}
    </div>
  );
}
