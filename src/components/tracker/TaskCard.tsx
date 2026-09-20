"use client";

import { useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import type { Section, Task } from "@/types/tracker";
import { fmtDate, isDueSoon, isDueTodayHighlight, isOverdue, recurLabel } from "@/lib/taskDisplay";
import { withoutSelfMark } from "@/lib/actorName";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSwipeComplete } from "@/hooks/useSwipeComplete";
import ActionMenu, { type ActionMenuItem } from "./ActionMenu";
import type { MyRole } from "@/lib/myRole";
import type { TaskStage } from "@/lib/taskProgress";

// Кубик на доске.
//
// Переписан 19.09.2026 по разбору Кирилла: «вместо прямоугольников сделать
// квадраты, убрать лишнюю бесполезную инфу из кубиков задач гуляющих по
// канбану, подобрать размер шрифтов, маркеры важных пометок, чтоб
// гармонично смотрелось, УБРАТЬ НЕНУЖНОЕ!»
//
// Что ушло и почему:
//   Приоритет — целиком. Сначала со слова «Высокий» он ужался до точки в
//     углу, а 20.09.2026 ушёл совсем: «удали везде приоритетности, они не
//     нужны». Точку он же и не смог опознать («это что?»), и это
//     справедливо: важность выставлялась один раз при заведении и дальше
//     ничего о задаче не говорила. Что горит — говорит срок.
//   «0 из 2 · ждём: Кирилл, Юра» — на доске осталось «0/2». Имена
//     помещались через раз, а нужны они в тот момент, когда карточку уже
//     открыли.
//   Раздел пилюлей — теперь цветная полоска слева. Раздел важен как
//     принадлежность, а не как текст: глазом он ищется по цвету.
//   «на приёмке» пилюлей — столбец доски и так называется «На приёмке».
//
// Что добавилось:
//   роль цветом (см. lib/myRole): исполнителю — фирменный, соисполнителю
//     обычный тон, наблюдателю приглушённый;
//   «!» в правом верхнем углу за три рабочих дня до срока;
//   стрелка ↗ там, где поручение исходящее — моё, отданное другому.

export default function TaskCard({
  task,
  section,
  progress,
  stage,
  role = "none",
  outgoing,
  dimOverdue,
  onToggleDone,
  canComplete = true,
  onOpen,
  isDragging,
  dragProps,
  justCreated,
  menuItems,
  authorName,
}: {
  task: Task;
  section: Section | null;
  // «1/3» — и только когда исполнителей больше одного (progressShort).
  progress?: string;
  // Где задача стоит: отсюда берутся «не может» и «на доработке».
  stage?: TaskStage;
  // Моя роль в этой задаче: она решает, каким тоном нарисован кубик.
  role?: MyRole;
  // Это я поручил кому-то. Не цвет, а маленькая стрелка: цвет уже занят
  // ролью и сроком, и третий смысл превратил бы доску в светофор.
  outgoing?: boolean;
  // Просрочка есть, но кричать о ней этому человеку не о чем: он
  // наблюдатель, или это его собственное поручение другому.
  dimOverdue?: boolean;
  onToggleDone: () => void;
  // Есть ли у меня право закрыть эту задачу одним движением. Галочка и
  // свайп — это «принято», слово постановщика; исполнителю вместо них
  // кнопки в самой карточке, где спрашивают, что именно сделано.
  canComplete?: boolean;
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
  // Всё, что мышь делает перетаскиванием: поднять карточку выше, собрать по
  // ней встречу, отправить коллеге. Показывается только на телефоне.
  menuItems?: ActionMenuItem[];
  // Имя постановщика, когда поручение пришло от другого человека.
  authorName?: string;
}) {
  const isMobile = useIsMobile();
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null);
  // Finishing something is the action of the day — on a phone it is a
  // swipe to the right, and reopening it is the same swipe again.
  const swipe = useSwipeComplete(onToggleDone, isMobile && canComplete);

  // Просрочка есть или нет — вопрос к задаче; кричать о ней этому
  // человеку или нет — вопрос к его роли (см. lib/myRole). Поэтому две
  // величины, а не одна: заливку получает тот, кого срок касается, а
  // красную дату — все, потому что иначе «горит» ничем не отличается от
  // «идёт».
  const late = isOverdue(task);
  const overdue = late && !dimOverdue;
  const dueToday = !late && isDueTodayHighlight(task) && !dimOverdue;
  const soon = !late && !dueToday && isDueSoon(task) && !dimOverdue;

  const card = (
    <div
      className={
        "task" +
        (task.status === "done" ? " done" : "") +
        (overdue ? " overdue" : "") +
        (dueToday ? " due-today" : "") +
        (isDragging ? " dragging" : "") +
        (justCreated ? " just-created" : "") +
        " role-" + role
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
      {/* Раздел — полоской слева, своим цветом. Текстом он повторялся на
          каждом кубике и съедал строку. */}
      {section && <span className={"task-section-bar" + (section.kind === "personal" ? " personal" : "")} title={section.name} />}

      <div className="task-body">
        <div className="task-head">
          {canComplete && (
            <div
              className={"check" + (task.status === "done" ? " checked" : "")}
              title={task.status === "done" ? "Вернуть задачу в работу" : "Закрыть задачу"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleDone();
              }}
            >
              {task.status === "done" ? "✓" : ""}
            </div>
          )}
          <div className="task-title">{task.title}</div>
          {/* Маркеры угла. Их осталось два, и подписаны они целыми
              фразами: 20.09.2026 Кирилл спросил про них прямо — «это
              что?», — а значок, который надо расшифровывать, не работает.
              Точка приоритета отсюда ушла вместе с самим приоритетом. */}
          <span className="task-marks">
            {outgoing && (
              <span className="task-mark outgoing" title="Это поручили вы — ждём ответа исполнителя">
                ↗
              </span>
            )}
            {soon && (
              <span className="task-mark soon" title="Срок через три рабочих дня или меньше">
                !
              </span>
            )}
          </span>
        </div>

        <div className="task-meta">
          {/* Имя без пометки «(я)»: на карточке она ничего не добавляет —
              своя роль в задаче показана цветом, — а у четырнадцати
              человек читается как чужая опечатка. В базе имя остаётся
              полным: по нему задачу находят бот и сводки. */}
          {task.assignee && <span className="task-assignee">{withoutSelfMark(task.assignee)}</span>}
          {authorName && <span className="task-from">от {authorName}</span>}
          {task.deadline && (
            <span className={"task-due" + (late ? " overdue-text" : dueToday ? " due-today-text" : "")}>
              {late ? "просрочено " : dueToday ? "сегодня" : ""}
              {dueToday ? "" : fmtDate(task.deadline)}
            </span>
          )}
          {!task.deadline && task.recur !== "none" && isDueTodayHighlight(task) && <span className="task-due due-today-text">сегодня</span>}
          {recurLabel(task) && <span className="task-recur">{recurLabel(task)}</span>}
          {progress && <span className="task-progress-short">{progress}</span>}
          {/* Два состояния, которых не видно по столбцу: «В работе» стоит и
              тот, кто взялся, и тот, кто отказался, и тот, кому вернули.
              Разница между ними — это разница между «идёт» и «стоит». */}
          {stage === "blocked" && <span className="task-state blocked">не может</span>}
          {stage === "returned" && <span className="task-state returned">на доработке</span>}
        </div>
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
