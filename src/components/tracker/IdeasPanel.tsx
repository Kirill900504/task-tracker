"use client";

import { useState } from "react";
import type { Idea } from "@/types/tracker";
import { sortIdeasForList } from "@/lib/ideaDisplay";
import { isMine } from "@/lib/ownership";
import { formatIdeaCreatedAt } from "@/lib/trackerRows";
import { uid } from "@/lib/uid";
import IdeaItem from "./IdeaItem";
import type { useToasts } from "@/hooks/useToasts";
import PanelDragHandle, { resolveDragHandleProps, type PanelDragProps } from "./PanelDragHandle";
import AutoGrowTextarea from "./AutoGrowTextarea";
import MicButton from "./MicButton";

export default function IdeasPanel({
  myUserId = "",
  ideas,
  showDone,
  highlightId,
  actions,
  toasts,
  onConvertToTask,
  onConvertToMeeting,
  dragHandleProps,
  isDragging,
  dropIndicatorBefore,
}: {
  // Свой auth-id: чужую мысль прислали тебе, а не отдали.
  myUserId?: string;
  ideas: Idea[];
  showDone: boolean;
  actions: {
    saveIdea: (idea: Idea) => void;
    deleteIdea: (id: string) => void;
    restoreIdea: (idea: Idea) => void;
  };
  toasts: ReturnType<typeof useToasts>;
  // Conversions live in the parent, which owns both ideas and tasks — the
  // same handlers the drop targets call, so a button and a drag end up
  // doing exactly one thing, undo toast included.
  onConvertToTask: (ideaId: string, term: "short" | "long") => void;
  onConvertToMeeting: (ideaId: string) => void;
  // The idea the global search just jumped to, briefly flashed.
  highlightId?: string | null;
} & PanelDragProps) {
  const [text, setText] = useState("");
  const visible = sortIdeasForList(ideas, showDone);

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
    <div className={"panel dash-panel" + (isDragging ? " dragging" : "") + (dropIndicatorBefore ? " drag-indicator" : "")} id="ideasPanel" data-panel-id="ideasPanel">
      <div className="dash-panel-head">
        <PanelDragHandle {...resolveDragHandleProps(dragHandleProps)} />
        <div className="panel-title">
          Идеи и мысли <span className="count">{visible.length}</span>
        </div>
      </div>
      <div className="idea-add">
        <AutoGrowTextarea
          id="ideaInput"
          // Без эмодзи: значок микрофона стоит тут же, справа от поля, — и
          // нарисованный, а не в виде наклейки посреди подсказки, где он к
          // тому же ломал её на две строки.
          placeholder="Мысль, идея (M)… Enter — сохранить"
          value={text}
          onChange={setText}
          singleLine
          onEnter={add}
        />
        {/* Кнопки «+» рядом нет: надиктованная мысль сохраняется сама, как
            только человек замолчал, а набранная — по Enter. Кнопка повторяла
            то, что и так происходит, и занимала место в строке, которой
            пользуются одной рукой. */}
        <MicButton value={text} onChange={setText} onDone={(finalText) => addText(finalText)} title="Надиктовать мысль" />
      </div>
      <div id="ideaList">
        {visible.length === 0 ? (
          <div className="empty">{ideas.length === 0 ? "Пока пусто — запишите первую мысль" : "Нет активных мыслей"}</div>
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
              onConvertToTask={(term) => onConvertToTask(idea.id, term)}
              onConvertToMeeting={() => onConvertToMeeting(idea.id)}
              highlighted={highlightId === idea.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
