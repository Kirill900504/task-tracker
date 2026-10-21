"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useColleagues } from "@/hooks/useColleagues";
import type { Idea } from "@/types/tracker";
import ActionMenu from "./ActionMenu";
import SendMenu from "./SendMenu";
import AutoGrowTextarea from "./AutoGrowTextarea";
import MicButton from "./MicButton";
import AddButton from "./AddButton";
import Icon from "./Icon";
import PopLayer from "./PopLayer";
import { stateLabel, type SentTo } from "@/lib/ideaRecipients";
import { postOrQueue } from "@/lib/outbox";

// «09.10.2026 13:47» → «09.10 13:47», если год текущий: в нижнем ряду мысли
// рядом с тремя кнопками словами каждый символ на счету, а свой год читается
// и так. Мысль прошлого года сохраняет год. Время — отдельным куском: в
// колонке мыслей уже 320px (окно уже 1920) дата, время и три слова в одну
// строку не встают, и тогда уходит время (@container в tracker.css), а не
// ряд ломается надвое. Полная дата — всегда подсказкой.
function IdeaStamp({ stamp }: { stamp: string }) {
  const m = /^(\d{2}\.\d{2})\.(\d{4}) (.*)$/.exec(stamp || "");
  if (!m) return <>{stamp}</>;
  const thisYear = Number(m[2]) === new Date().getFullYear();
  return (
    <>
      <span className="idea-date">{thisYear ? m[1] : `${m[1]}.${m[2]}`}</span>
      <span className="idea-time"> {m[3]}</span>
    </>
  );
}

export default function IdeaItem({
  idea,
  onToggleDone,
  onToggleImportant,
  canEdit = true,
  onEditText,
  onDelete,
  onConvertToTask,
  onConvertToMeeting,
  highlighted,
  sentTo,
}: {
  idea: Idea;
  onToggleDone: () => void;
  onToggleImportant: () => void;
  // Чужая мысль правится только автором.
  canEdit?: boolean;
  onEditText: (text: string) => void;
  onDelete: () => void;
  // Turning a thought into work used to be a drag — onto a task column or
  // onto a calendar day. A finger cannot do that, so the same two
  // conversions are also a button; the drag still works with a mouse.
  onConvertToTask: () => void;
  onConvertToMeeting: () => void;
  // Set when the global search sent you here — flashes the item the same
  // way a freshly created task flashes.
  highlighted?: boolean;
  // Кому мысль уже отправлена и что каждый ответил (lib/ideaRecipients).
  sentTo?: SentTo[];
}) {
  const { colleagues } = useColleagues();
  // Who to send this thought to is asked at the moment of sending: unlike a
  // task, a thought has no assignee of its own.
  const [pickerAt, setPickerAt] = useState<DOMRect | null>(null);
  const [convertAt, setConvertAt] = useState<DOMRect | null>(null);
  const [sendNote, setSendNote] = useState("");
  const [taking, setTaking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(idea.text);
  // Мысль берут и несут: в столбец задач, на день календаря, в список
  // встреч. Сортировки внутри списка у мыслей нет, поэтому draggable, а не
  // sortable — расступаться тут нечему.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: "idea:" + idea.id,
    data: { payload: { kind: "idea", id: idea.id, text: idea.text } },
  });

  const savedRef = useRef(false);

  // «Кому отправлена» — та же всплывашка, что у участников встречи
  // (MeetingChip, .people-tooltip): по наведению на ПК, по нажатию на
  // телефоне, где наведения нет. В верхнем слое — список мыслей
  // прокручивается и обрезал бы подсказку у нижних строк.
  const [sentAnchor, setSentAnchor] = useState<DOMRect | null>(null);
  const sentRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = sentRef.current;
    if (!sentAnchor || !el) return;
    let top = sentAnchor.bottom + 4;
    if (top + el.offsetHeight > window.innerHeight - 8) top = sentAnchor.top - el.offsetHeight - 4;
    el.style.top = top + "px";
    el.style.left = Math.max(8, Math.min(sentAnchor.left, window.innerWidth - el.offsetWidth - 8)) + "px";
  }, [sentAnchor]);
  const sent = sentTo || [];
  // В списке автора с 0051 остаются только ПОДЕЛЁННЫЕ мысли (отправленные
  // уходят в окно «Отправленные»), а у поделённой ответа никто не ждёт —
  // «1/2» там читалось бы как недостача. Число ответивших показывается,
  // только если мысль кому-то ещё и отправлена.
  const sharedOnly = sent.length > 0 && sent.every((s) => s.kind === "share");
  const answered = sharedOnly ? 0 : sent.filter((s) => s.kind === "send" && s.state !== "none").length;

  // Кому вообще можно передать мысль — всем, кроме себя: она доходит и в
  // список мыслей получателя в трекере, а не только в мессенджер (SendMenu,
  // api/telegram/send). Здесь стоял фильтр «подключён к мессенджеру», и
  // пока не подключён никто, кнопки «Отправить» не было вовсе — при том что
  // меню за ней предлагает всю команду. Список общий (useColleagues) и
  // следит за таблицей людей: убрали человека — он пропал отсюда, добавили —
  // появился, без перезагрузки.
  const teammates = colleagues.filter((c) => !c.isMe);

  // The note under the thought clears itself: unlike a modal, this row
  // stays on screen, and yesterday's «Отправлено: Аня» would sit there for
  // as long as the thought does.
  function noteResult(message: string) {
    setSendNote(message);
    if (!message.startsWith("Отправляю")) setTimeout(() => setSendNote(""), 4000);
  }

  // Присланная мысль становится задачей на меня. Ответ маршрута показывается
  // здесь же, под самой мыслью: результат принадлежит той кнопке, которую
  // нажали, а не низу панели.
  async function takeIntoWork() {
    setTaking(true);
    try {
      // Нет связи — просьба ждёт сети в очереди (lib/outbox) и уйдёт сама.
      const result = await postOrQueue("/api/workspace/report", { action: "take_idea", ideaId: idea.id }, "Не получилось взять в работу");
      noteResult(result.queued ? "Нет связи — задача заведётся, когда появится сеть" : "Готово — задача заведена на вас");
    } catch (err) {
      noteResult(err instanceof Error ? err.message : "Не получилось взять в работу");
    } finally {
      setTaking(false);
    }
  }

  function startEdit() {
    // Чужую мысль не правят: её прислали, а не отдали, и база откажет.
    if (!canEdit) return;
    setDraft(idea.text);
    savedRef.current = false;
    setEditing(true);
  }

  function save() {
    if (savedRef.current) return;
    savedRef.current = true;
    const v = draft.trim();
    if (v) onEditText(v);
    setEditing(false);
  }

  function cancel() {
    savedRef.current = true;
    setEditing(false);
  }

  return (
    <div
      className={
        "idea-item" +
        (idea.important ? " important" : "") +
        (idea.done ? " done" : "") +
        (highlighted ? " just-created" : "") +
        (isDragging ? " dragging" : "")
      }
      data-idea-id={idea.id}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
    >
      {/* Галочки слева больше нет: «Завершить» — словом, в общем ряду
          действий под текстом (21.10.2026, его слова: «кнопками словами по
          типу кнопок во встречах, только меньшими по размерам и
          помещающимися в одну строку снизу с датой и временем»). Текст от
          этого получил всю ширину карточки, кроме угла с «Важно» и ×. */}
      <div className="idea-body">
        <div className="idea-head">
          {editing ? (
            // The mic sits inside the edit row so a thought can be corrected by
            // voice too. Dictating counts as typing here — it fills the draft
            // and you still confirm with Enter (or by clicking away).
            <div className="input-with-mic">
              <AutoGrowTextarea
                className="idea-edit-input"
                autoFocus
                // Курсор в конец: мысль правят, чтобы дописать или поправить
                // хвост, а браузер ставит его в начало, и первое же слово
                // вставало перед текстом (13.10.2026, «поставь курсор в конец»).
                focusAtEnd
                value={draft}
                onChange={setDraft}
                onEnter={save}
                // Clicking away still saves, as it always has — except when the
                // click landed on this row's own mic button, which would
                // otherwise end the edit before it could dictate anything.
                onBlur={(e) => {
                  if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) save();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancel();
                }}
              />
              <AddButton title="Сохранить мысль" disabled={!draft.trim()} onClick={save} />
              <MicButton value={draft} onChange={setDraft} title="Надиктовать мысль" />
            </div>
          ) : (
            <div className="idea-text" title="Нажмите, чтобы отредактировать" onClick={startEdit}>
              {idea.text}
            </div>
          )}
          {/* «Важно» и «Удалить» — в правом верхнем углу, цветными
              кнопками, как крестик у карточки встречи: там их ищут, а в
              нижнем ряду рядом с тремя словами им не хватило бы места.
              Флажок говорит своё состояние заливкой: красный контур —
              «можно отметить», залитый — «важно», и тогда же краснеет вся
              карточка. Чужую мысль не помечают и не удаляют — это строка
              автора, база откажет молча. */}
          {canEdit && !editing && (
            <div className="idea-corner">
              <button
                type="button"
                className={"idea-flag idea-important" + (idea.important ? " active" : "")}
                title={idea.important ? "Важная мысль — нажмите, чтобы снять пометку" : "Отметить как важную: карточка станет красной"}
                aria-label={idea.important ? "Снять пометку «Важно»" : "Отметить «Важно»"}
                aria-pressed={idea.important}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleImportant();
                }}
              >
                <Icon name="flag" size={14} />
              </button>
              <button
                type="button"
                className="idea-del"
                title="Удалить мысль"
                aria-label="Удалить мысль"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
        </div>
        <div className="idea-foot">
          <div className="idea-meta" title={idea.createdAt}>
            <IdeaStamp stamp={idea.createdAt} />
            {sent.length > 0 && (
              <span
                className="idea-sent"
                data-idea-sent={idea.id}
                onMouseEnter={(e) => setSentAnchor(e.currentTarget.getBoundingClientRect())}
                onMouseLeave={() => setSentAnchor(null)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setSentAnchor((cur) => (cur ? null : r));
                }}
              >
                <Icon name="send" size={11} /> {answered ? `${answered}/${sent.length}` : sent.length}
              </span>
            )}
          </div>
          {/* Действия словами — та же форма, что «Успех / Провал / Перенос»
              у встречи, только мельче. Подпись меняется только у
              «Завершить» ↔ «Вернуть» (слова одной длины): соседи не ездят. */}
          <div className="idea-actions">
            <button
              type="button"
              className="idea-act idea-convert"
              title="Сделать задачей или встречей"
              data-convert-idea={idea.id}
              onClick={(e) => {
                e.stopPropagation();
                setConvertAt(e.currentTarget.getBoundingClientRect());
              }}
            >
              Создать
            </button>
            {teammates.length > 0 && (
              <button
                type="button"
                className="idea-act idea-send"
                title="Отправить коллеге или поделиться"
                onClick={(e) => {
                  e.stopPropagation();
                  setPickerAt(e.currentTarget.getBoundingClientRect());
                }}
              >
                Отправить
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className={"idea-act idea-check" + (idea.done ? " checked" : "")}
                title={idea.done ? "Вернуть в активные" : "Отметить завершённой"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleDone();
                }}
              >
                {idea.done ? "Вернуть" : "Завершить"}
              </button>
            )}
            {/* Чужая мысль, присланная мне: единственное, что с ней можно
                сделать, — взять в работу. Заводить себе задачу из браузера
                нельзя (в свою задачу исполнителем себя не впишешь — писать в
                task_participants вправе владелец пространства), поэтому идёт
                это тем же серверным маршрутом, что и кнопка под сообщением
                бота. */}
            {!canEdit && !idea.done && (
              <button
                type="button"
                className="idea-act idea-take-act"
                title="Завести себе задачу из этой мысли"
                disabled={taking}
                onClick={(e) => {
                  e.stopPropagation();
                  void takeIntoWork();
                }}
              >
                {taking ? "…" : "В работу"}
              </button>
            )}
          </div>
        </div>
      </div>
      {sendNote && <div className="send-result">{sendNote}</div>}
      {convertAt && (
        <ActionMenu
          anchor={convertAt}
          title="Во что превратить"
          onClose={() => setConvertAt(null)}
          items={[
            { id: "task", label: "Сделать задачей", icon: "check", onSelect: () => onConvertToTask() },
            { id: "meeting", label: "Назначить встречу", icon: "calendar", onSelect: () => onConvertToMeeting() },
          ]}
        />
      )}
      {sentAnchor && sent.length > 0 && (
        <PopLayer>
          <div ref={sentRef} className="people-tooltip idea-sent-tooltip" id="ideaSentTooltip" style={{ display: "block", top: -9999, left: -9999 }}>
            <div className="ptitle">{sharedOnly ? "Поделились" : "Отправлено"}</div>
            {sent.map((s) => (
              <div className={"prow " + (s.state === "none" ? "vote-none" : "vote-yes")} key={s.name}>
                <span className="prow-mark" aria-hidden>
                  {s.state === "none" ? "•" : <Icon name={s.state === "taken" ? "arrow-right" : "check"} size={13} />}
                </span>
                <span className="prow-name">{s.name}</span>
                <span className="prow-note">{stateLabel(s.kind, s.state)}</span>
              </div>
            ))}
          </div>
        </PopLayer>
      )}
      {pickerAt && <SendMenu kind="idea" id={idea.id} anchor={pickerAt} onClose={() => setPickerAt(null)} onResult={noteResult} />}
    </div>
  );
}
