"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useColleagues } from "@/hooks/useColleagues";
import type { Idea } from "@/types/tracker";
import ActionMenu from "./ActionMenu";
import SendMenu from "./SendMenu";
import AutoGrowTextarea from "./AutoGrowTextarea";
import MicButton from "./MicButton";
import Icon from "./Icon";
import PopLayer from "./PopLayer";
import { stateLabel, type SentTo } from "@/lib/ideaRecipients";

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

  const linked = colleagues.filter((c) => c.linked && !c.isMe);

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
      const res = await fetch("/api/workspace/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "take_idea", ideaId: idea.id }),
      });
      const data = await res.json().catch(() => null);
      noteResult(!res.ok || !data || data.error ? data?.error || "Не получилось взять в работу" : "Готово — задача заведена на вас");
    } catch {
      noteResult("Не получилось взять в работу");
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
      <div
        className={"check idea-check" + (idea.done ? " checked" : "")}
        title={idea.done ? "Вернуть в активные" : "Отметить завершённой"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
      >
        {idea.done ? "✓" : ""}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          // The mic sits inside the edit row so a thought can be corrected by
          // voice too. Dictating counts as typing here — it fills the draft
          // and you still confirm with Enter (or by clicking away).
          <div className="input-with-mic">
            <AutoGrowTextarea
              className="idea-edit-input"
              autoFocus
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
            <MicButton value={draft} onChange={setDraft} title="Надиктовать мысль" />
          </div>
        ) : (
          <div className="idea-text" title="Нажмите, чтобы отредактировать" onClick={startEdit}>
            {idea.text}
          </div>
        )}
        {/* Дата и кнопки — ОДНОЙ строкой под текстом, а не колонкой справа
            от него. Справа ряд из четырёх кнопок отнимал у текста половину
            узкой панели, и длинная мысль рвалась по слогам в столбик
            («проконсу-льтировать-ся»), а поле правки сжималось до того же
            столбика. Слова Кирилла 08.10.2026: «не нравится, как
            отображаются длинные названия мыслей». Теперь текст идёт во всю
            ширину карточки. */}
        <div className="idea-foot">
          <div className="idea-meta">
            {idea.createdAt}
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
          <div className="idea-actions">
            <button
              className="idea-flag idea-convert"
              title="Сделать задачей или встречей"
              data-convert-idea={idea.id}
              onClick={(e) => {
                e.stopPropagation();
                setConvertAt(e.currentTarget.getBoundingClientRect());
              }}
            >
              <Icon name="arrow-right" size={15} />
            </button>
            {linked.length > 0 && (
              <button
                className="idea-flag"
                title="Отправить"
                onClick={(e) => {
                  e.stopPropagation();
                  setPickerAt(e.currentTarget.getBoundingClientRect());
                }}
              >
                <Icon name="send" size={15} />
              </button>
            )}
            <button
              className={"idea-flag" + (idea.important ? " active" : "")}
              title={idea.important ? "Снять пометку «Важно»" : "Отметить «Важно»"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleImportant();
              }}
            >
              <Icon name="flag" size={15} />
            </button>
            {/* Чужая мысль, присланная мне: единственное, что с ней можно
                сделать, — взять в работу. Заводить себе задачу из браузера
                нельзя (в свою задачу исполнителем себя не впишешь — писать в
                task_participants вправе владелец пространства), поэтому идёт
                это тем же серверным маршрутом, что и кнопка под сообщением
                бота. Раньше кнопка была только там и на экране «Что от вас
                ждут», которого больше нет. */}
            {!canEdit && !idea.done && (
              <button
                className="idea-take"
                title="Завести себе задачу из этой мысли"
                disabled={taking}
                onClick={(e) => {
                  e.stopPropagation();
                  void takeIntoWork();
                }}
              >
                {taking ? "…" : "＋ В работу"}
              </button>
            )}
            {canEdit && (
              <button
                className="idea-del"
                title="Удалить"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Icon name="close" size={15} />
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
