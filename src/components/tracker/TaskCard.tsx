"use client";

import { useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import type { Section, Task } from "@/types/tracker";
import { fmtDate, isDueTodayHighlight, isOverdue, priorityClass, priorityLabel, recurLabel } from "@/lib/taskDisplay";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSwipeComplete } from "@/hooks/useSwipeComplete";
import ActionMenu, { type ActionMenuItem } from "./ActionMenu";
import type { TaskStage } from "@/lib/taskProgress";
import Icon from "./Icon";

export default function TaskCard({
  task,
  section,
  progress,
  stage,
  onToggleDone,
  onOpen,
  isDragging,
  dragProps,
  justCreated,
  menuItems,
  authorName,
}: {
  task: Task;
  section: Section | null;
  // «2 из 4 · сделали: … · ждём: …» — пусто, пока исполнитель один или
  // не назначен никто. Считается в TasksPanel, потому что участники живут
  // отдельным слоем (см. useTaskParticipants).
  progress?: string;
  stage?: TaskStage;
  onToggleDone: () => void;
  onOpen: () => void;
  isDragging?: boolean;
  // Всё, чем dnd-kit делает карточку перетаскиваемой: ссылка на узел,
  // слушатели указателя и сдвиг, которым соседи расступаются. Карточка сама
  // ничего об этом не знает — её тянут и в панели задач, и в «Сегодня», где
  // перетаскивания нет вовсе, поэтому хук вызывает тот, кто её показывает.
  dragProps?: {
    ref?: (element: HTMLElement | null) => void;
    style?: CSSProperties;
    attributes?: HTMLAttributes<HTMLElement>;
    listeners?: Record<string, unknown>;
  };
  justCreated?: boolean;
  // Everything the card can do that a mouse would do by dragging it —
  // moving it up the column, sending it to the other column, turning it into
  // a meeting. Shown only on a phone: with a mouse the drag is still there
  // and is faster.
  menuItems?: ActionMenuItem[];
  // Имя постановщика, когда это НЕ смотрящий. Пусто, пока задачи ставит
  // один человек, — и тогда пилюли нет вовсе: подпись, которая всегда
  // одинакова, не говорит ничего.
  authorName?: string;
}) {
  const isMobile = useIsMobile();
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null);
  // Finishing something is the action of the day — on a phone it is a
  // swipe to the right, and reopening it is the same swipe again.
  const swipe = useSwipeComplete(onToggleDone, isMobile);

  const overdue = isOverdue(task);
  const dueToday = !overdue && isDueTodayHighlight(task);

  const card = (
    <div
      className={
        "task" +
        (task.status === "done" ? " done" : "") +
        (task.priority === "high" ? " high" : "") +
        (overdue ? " overdue" : "") +
        (dueToday ? " due-today" : "") +
        (isDragging ? " dragging" : "") +
        (justCreated ? " just-created" : "")
      }
      data-id={task.id}
      ref={dragProps?.ref}
      // Свайп «сделано» на телефоне побеждает сдвиг перетаскивания: пока
      // палец ведёт карточку вбок, она и должна ехать за пальцем, а не
      // расступаться перед соседом.
      style={swipe.offset ? { transform: `translateX(${swipe.offset}px)`, transition: "none" } : dragProps?.style}
      {...dragProps?.attributes}
      {...dragProps?.listeners}
      {...swipe.handlers}
      onClick={onOpen}
    >
      <div
        className={"check" + (task.status === "done" ? " checked" : "")}
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
      >
        {task.status === "done" ? "✓" : ""}
      </div>
      <div className="task-body">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {section && <span className={"pill pill-section" + (section.kind === "personal" ? " pill-section-personal" : "")}>{section.name}</span>}
          {/* От кого поручение. Стоит ПЕРЕД исполнителем: «от Игоря →
              Никите» читается как предложение, а обратный порядок — как
              ребус. */}
          {authorName && <span className="pill pill-author">от {authorName}</span>}
          {task.assignee && (
            <div className="task-assignee">
              <span className="arrow">→</span>
              {task.assignee}
            </div>
          )}
          {task.deadline && (
            <span className={"pill pill-date" + (overdue ? " overdue-text" : "") + (dueToday ? " due-today-text" : "")}>
              {(overdue ? "Просрочено: " : dueToday ? "Сегодня: " : "до ") + fmtDate(task.deadline)}
            </span>
          )}
          {!task.deadline && task.recur !== "none" && isDueTodayHighlight(task) && <span className="pill pill-date due-today-text">● Выполнить сегодня</span>}
          <span className={"pill " + priorityClass(task.priority)}>{priorityLabel(task.priority)}</span>
          {recurLabel(task) && <span className="pill pill-recur">{recurLabel(task)}</span>}
          {/* Pressed «Принял» in Telegram — the answer to «взял в работу?»,
              without having to ask. Dropped once the task is done, where it
              would only be noise.

              Only where there is one person to speak for. tasks.accepted_at
              is set by whoever pressed first, so on a task standing on four
              people this pill read «принял» after one of them — the exact
              misreading («значит, взяли») that the progress line below is
              there to prevent. Where that line exists, it is the truth and
              this pill is not. */}
          {task.acceptedAt && !progress && task.status !== "done" && <span className="pill pill-accepted"><Icon name="check" size={12} /> принял</span>}
          {/* Стадия важнее, чем «принял»: «на приёмке» — это очередь
              Кирилла, «кто-то не может» — остановка, о которой иначе
              узнаёшь последним. */}
          {stage === "awaiting_review" && task.status !== "done" && <span className="pill pill-review"><Icon name="eye" size={12} /> на приёмке</span>}
          {stage === "blocked" && task.status !== "done" && <span className="pill pill-blocked"><Icon name="ban" size={12} /> не может</span>}
          {stage === "returned" && task.status !== "done" && <span className="pill pill-returned">↩ на доработке</span>}
        </div>
        {progress && <div className="task-progress">{progress}</div>}
      </div>
      {isMobile && !!menuItems?.length && (
        <button
          className="task-menu-btn"
          title="Действия"
          data-task-menu={task.id}
          onClick={(e) => {
            e.stopPropagation();
            setMenuAt(e.currentTarget.getBoundingClientRect());
          }}
        >
          ⋮
        </button>
      )}
      {menuAt && !!menuItems?.length && <ActionMenu anchor={menuAt} title={task.title} items={menuItems} onClose={() => setMenuAt(null)} />}
    </div>
  );

  if (!isMobile) return card;

  // The swipe hint lives behind the card, so it appears from under it as
  // the card slides.
  return (
    <div className={"swipe-wrap" + (swipe.armed ? " armed" : "")}>
      <div className="swipe-hint">{task.status === "done" ? "↩ вернуть" : "✓ готово"}</div>
      {card}
    </div>
  );
}
