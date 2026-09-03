"use client";

import { useRef, useState } from "react";
import type { Idea } from "@/types/tracker";

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
          <textarea
            className="idea-edit-input"
            autoFocus
            defaultValue={idea.text}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              } else if (e.key === "Escape") {
                cancel();
              }
            }}
          />
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
