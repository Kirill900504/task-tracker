"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sendToTelegram, useColleagues } from "@/hooks/useColleagues";
import type { Idea } from "@/types/tracker";
import AutoGrowTextarea from "./AutoGrowTextarea";
import MicButton from "./MicButton";

export default function IdeaItem({
  idea,
  onToggleDone,
  onToggleImportant,
  onEditText,
  onDelete,
  highlighted,
}: {
  idea: Idea;
  onToggleDone: () => void;
  onToggleImportant: () => void;
  onEditText: (text: string) => void;
  onDelete: () => void;
  // Set when the global search sent you here — flashes the item the same
  // way a freshly created task flashes.
  highlighted?: boolean;
}) {
  const { colleagues } = useColleagues();
  // Who to send this thought to is asked at the moment of sending: unlike a
  // task, a thought has no assignee of its own.
  const [pickerAt, setPickerAt] = useState<DOMRect | null>(null);
  const [sendNote, setSendNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(idea.text);
  const savedRef = useRef(false);

  const linked = colleagues.filter((c) => c.linked);

  async function sendTo(name: string) {
    setPickerAt(null);
    setSendNote("Отправляю…");
    const result = await sendToTelegram("idea", idea.id, [name]);
    setSendNote("error" in result ? result.error : result.sentTo.length ? `Отправлено: ${result.sentTo.join(", ")}` : `Не дошло: ${result.failed.join(", ")}`);
    setTimeout(() => setSendNote(""), 4000);
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
      {pickerAt &&
        createPortal(
          <>
            <div className="export-backdrop" onClick={() => setPickerAt(null)} />
            <div className="export-menu" style={{ top: pickerAt.bottom + 6, right: Math.max(8, window.innerWidth - pickerAt.right) }}>
              <div className="export-sep" style={{ borderTop: 0, marginTop: 0, paddingTop: 2 }}>
                Кому отправить
              </div>
              {linked.map((person) => (
                <button key={person.id} className="export-item" onClick={() => sendTo(person.name)}>
                  {person.name}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
