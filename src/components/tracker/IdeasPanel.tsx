"use client";

import { useEffect, useState } from "react";
import type { Idea } from "@/types/tracker";
import { doneIdeasNewestFirst, sortIdeasForList } from "@/lib/ideaDisplay";
import { isMine } from "@/lib/ownership";
import { formatIdeaCreatedAt } from "@/lib/trackerRows";
import { uid } from "@/lib/uid";
import IdeaItem from "./IdeaItem";
import DoneListModal from "./DoneListModal";
import Icon from "./Icon";
import type { useToasts } from "@/hooks/useToasts";
import AutoGrowTextarea from "./AutoGrowTextarea";
import MicButton from "./MicButton";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function IdeasPanel({
  myUserId = "",
  ideas,
  highlightId,
  actions,
  toasts,
  onConvertToTask,
  onConvertToMeeting,
  focusAddSignal = 0,
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
  // The idea the global search just jumped to, briefly flashed.
  highlightId?: string | null;
  // Круглая «+» на телефоне нажата в разделе мыслей. Заводить мысль
  // нечем — окна у неё нет, — значит «создать» здесь означает «поставить
  // курсор в поле», и панель делает это сама. Счётчик, а не флаг: второе
  // нажатие подряд должно сработать так же, как первое.
  focusAddSignal?: number;
}) {
  const isMobile = useIsMobile();
  const [text, setText] = useState("");
  // Окно с вычеркнутыми мыслями.
  const [doneOpen, setDoneOpen] = useState(false);
  // В панели — только живые мысли. Вычеркнутые смотрят в отдельном окне
  // по иконке с галочкой: перечёркнутые строки посреди списка мыслей —
  // это шум там, где ищут, что записать дальше.
  const visible = sortIdeasForList(ideas, false);
  // Свежевычеркнутые сверху — тем же правилом, что у доски и встреч.
  const done = doneIdeasNewestFirst(ideas);

  // Фокус — побочное действие над DOM, а не состояние, поэтому эффект
  // здесь на своём месте (правило React-компилятора запрещает setState в
  // эффекте, а не работу с узлом). Нулевой сигнал — это первая отрисовка:
  // открывать клавиатуру тому, кто просто зашёл в раздел, незачем.
  useEffect(() => {
    if (!focusAddSignal) return;
    const el = document.getElementById("ideaInput") as HTMLTextAreaElement | HTMLInputElement | null;
    el?.focus();
  }, [focusAddSignal]);

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
            Идеи и мысли <span className="count">{visible.length}</span>
          </div>
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
              onConvertToTask={() => onConvertToTask(idea.id)}
              onConvertToMeeting={() => onConvertToMeeting(idea.id)}
              highlighted={highlightId === idea.id}
            />
          ))
        )}
      </div>

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
