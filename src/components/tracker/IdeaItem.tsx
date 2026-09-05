"use client";

import { useRef, useState } from "react";
import type { Idea } from "@/types/tracker";
import AutoGrowTextarea from "./AutoGrowTextarea";
import MicButton from "./MicButton";

export default function IdeaItem({
  idea,
  onToggleDone,
  onToggleImportant,
  onEditText,
  onDelete,
}: {
  idea: Idea;
  onToggleDone: () => void;
  onToggleImportant: () => void;
  onEditText: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(idea.text);
  const savedRef = useRef(false);

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
      className={"idea-item" + (idea.important ? " important" : "") + (idea.done ? " done" : "")}
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
    </div>
  );
}
