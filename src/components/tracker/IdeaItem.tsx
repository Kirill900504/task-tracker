"use client";

import { useRef, useState } from "react";
import { useColleagues } from "@/hooks/useColleagues";
import type { Idea } from "@/types/tracker";
import ActionMenu from "./ActionMenu";
import SendMenu from "./SendMenu";
import AutoGrowTextarea from "./AutoGrowTextarea";
import MicButton from "./MicButton";

export default function IdeaItem({
  idea,
  onToggleDone,
  onToggleImportant,
  onEditText,
  onDelete,
  onConvertToTask,
  onConvertToMeeting,
  highlighted,
}: {
  idea: Idea;
  onToggleDone: () => void;
  onToggleImportant: () => void;
  onEditText: (text: string) => void;
  onDelete: () => void;
  // Turning a thought into work used to be a drag — onto a task column or
  // onto a calendar day. A finger cannot do that, so the same two
  // conversions are also a button; the drag still works with a mouse.
  onConvertToTask: (term: "short" | "long") => void;
  onConvertToMeeting: () => void;
  // Set when the global search sent you here — flashes the item the same
  // way a freshly created task flashes.
  highlighted?: boolean;
}) {
  const { colleagues } = useColleagues();
  // Who to send this thought to is asked at the moment of sending: unlike a
  // task, a thought has no assignee of its own.
  const [pickerAt, setPickerAt] = useState<DOMRect | null>(null);
  const [convertAt, setConvertAt] = useState<DOMRect | null>(null);
  const [sendNote, setSendNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(idea.text);
  const savedRef = useRef(false);

  const linked = colleagues.filter((c) => c.linked);

  // The note under the thought clears itself: unlike a modal, this row
  // stays on screen, and yesterday's «Отправлено: Аня» would sit there for
  // as long as the thought does.
  function noteResult(message: string) {
    setSendNote(message);
    if (!message.startsWith("Отправляю")) setTimeout(() => setSendNote(""), 4000);
  }

  function startEdit() {
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
      className={"idea-item" + (idea.important ? " important" : "") + (idea.done ? " done" : "") + (highlighted ? " just-created" : "")}
      data-idea-id={idea.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-idea-id", idea.id);
        e.dataTransfer.effectAllowed = "move";
      }}
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
        <div className="idea-meta">{idea.createdAt}</div>
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
          ⇢
        </button>
        {linked.length > 0 && (
          <button
            className="idea-flag"
            title="Отправить в Telegram"
            onClick={(e) => {
              e.stopPropagation();
              setPickerAt(e.currentTarget.getBoundingClientRect());
            }}
          >
            ✈
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
          🚩
        </button>
        <button
          className="idea-del"
          title="Удалить"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ×
        </button>
      </div>
      {sendNote && <div className="send-result">{sendNote}</div>}
      {convertAt && (
        <ActionMenu
          anchor={convertAt}
          title="Во что превратить"
          onClose={() => setConvertAt(null)}
          items={[
            { id: "short", label: "✓ В задачи — краткосрочная", onSelect: () => onConvertToTask("short") },
            { id: "long", label: "✓ В задачи — долгосрочная", onSelect: () => onConvertToTask("long") },
            { id: "meeting", label: "📅 Назначить встречу", onSelect: () => onConvertToMeeting() },
          ]}
        />
      )}
      {pickerAt && <SendMenu kind="idea" id={idea.id} anchor={pickerAt} onClose={() => setPickerAt(null)} onResult={noteResult} />}
    </div>
  );
}
