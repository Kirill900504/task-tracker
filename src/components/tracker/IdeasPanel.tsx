"use client";

import { useState } from "react";
import type { Idea } from "@/types/tracker";
import { sortIdeasForList } from "@/lib/ideaDisplay";
import { formatIdeaCreatedAt } from "@/lib/trackerRows";
import { uid } from "@/lib/uid";
import IdeaItem from "./IdeaItem";
import type { useToasts } from "@/hooks/useToasts";
import PanelDragHandle, { resolveDragHandleProps, type PanelDragProps } from "./PanelDragHandle";

export default function IdeasPanel({
  ideas,
  showDone,
  actions,
  toasts,
  dragHandleProps,
  isDragging,
  dropIndicatorBefore,
}: {
  ideas: Idea[];
  showDone: boolean;
  actions: {
    saveIdea: (idea: Idea) => void;
    deleteIdea: (id: string) => void;
    restoreIdea: (idea: Idea) => void;
  };
  toasts: ReturnType<typeof useToasts>;
} & PanelDragProps) {
  const [text, setText] = useState("");
  const visible = sortIdeasForList(ideas, showDone);

  function add() {
    const v = text.trim();
    if (!v) return;
    actions.saveIdea({ id: uid(), text: v, important: false, done: false, createdAt: formatIdeaCreatedAt(new Date()) });
    setText("");
  }

  function deleteIdea(idea: Idea) {
    actions.deleteIdea(idea.id);
    toasts.showToast("Идея удалена", idea.text.slice(0, 60), () => actions.restoreIdea(idea));
  }

  return (
    <div className={"panel dash-panel" + (isDragging ? " dragging" : "") + (dropIndicatorBefore ? " drag-indicator" : "")} id="ideasPanel" data-panel-id="ideasPanel">
      <div className="dash-panel-head">
        <PanelDragHandle {...resolveDragHandleProps(dragHandleProps)} />
        <div className="panel-title">
          Идеи и мысли <span className="count">{visible.length}</span>
        </div>
      </div>
      <div className="idea-add">
        <input
          type="text"
          id="ideaInput"
          placeholder="Мысль, идея… Enter — сохранить"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn btn-primary btn-small" id="ideaAddBtn" onClick={add}>
          +
        </button>
      </div>
      <div id="ideaList">
        {visible.length === 0 ? (
          <div className="empty">{ideas.length === 0 ? "Пока пусто — запишите первую мысль" : "Нет активных мыслей"}</div>
        ) : (
          visible.map((idea) => (
            <IdeaItem
              key={idea.id}
              idea={idea}
              onToggleDone={() => actions.saveIdea({ ...idea, done: !idea.done })}
              onToggleImportant={() => actions.saveIdea({ ...idea, important: !idea.important })}
              onEditText={(newText) => actions.saveIdea({ ...idea, text: newText })}
              onDelete={() => deleteIdea(idea)}
            />
          ))
        )}
      </div>
    </div>
  );
}
