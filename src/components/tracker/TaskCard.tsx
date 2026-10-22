"use client";

import { useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import type { Section, Task } from "@/types/tracker";
import { isDueSoon, isDueTodayHighlight, isOverdue, recurLabel, todayStr } from "@/lib/taskDisplay";
import { withoutSelfMark } from "@/lib/actorName";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSwipeComplete } from "@/hooks/useSwipeComplete";
import ActionMenu, { type ActionMenuItem } from "./ActionMenu";
import Icon from "./Icon";
import PopLayer from "./PopLayer";
import PersonBadge from "./PersonBadge";
import type { MyRole } from "@/lib/myRole";
import type { TaskParticipant, TaskStage } from "@/lib/taskProgress";
import { CARD_KIND_HINT, type CardKind } from "@/lib/taskCardKind";
import { dueInfo } from "@/lib/dueLabel";
import { snoozeDay } from "@/lib/snooze";
import { personState } from "@/lib/personBadge";
import { prefetchComments } from "@/hooks/useItemComments";

// Кубик на доске.
//
// Переделан 13.10.2026 по разбору Кирилла: «убери лишние значки (это
// поручили вы — ждём ответа и все отчитались — ждём приёмки), далее выдели
// название задачи, возможно даже рамкой, и если оно длинное, при наведении
// должно высвечиваться поверх трекера окном с полным описанием… квадратик
// принудительного закрытия должен быть в правом верхнем углу, а номер
// задачи в левом верхнем, посередине в этой же строке должно вмещаться
// название (читабельно!). Отражение постановщика и исполнителей должно быть
// улучшено… с выделением, кто финишировал, кто взял в работу, а кто ещё
// вообще не приступал… лишние 0/6 можно убрать. Дедлайн тоже более
// выразителен должен быть».
//
// Отсюда три строки, и у каждой одна работа:
//   верх   — номер, название в рамке, галочка;
//   люди   — кто поручил и кому, каждый со значком этапа (PersonBadge);
//   низ    — срок пилюлей словами («до 19 окт · 6 дн.») и то, что ждёт решения.
//
// А весь кубик красит ОТНОШЕНИЕ задачи ко мне (lib/taskCardKind): моё
// поручение другим — фирменным, своя личная — спокойной тёплой отметкой,
// поручение мне — своим тоном, помогаю и смотрю — тише всех.
//
// Что ушло и почему — прежде, чем возвращать:
//   «0/6» — вместо цифры каждый исполнитель виден сам, со своим этапом;
//   стрелка ↗ «поручили вы» — это теперь цвет всего кубика;
//   значок «ждёт приёмки» — об этом говорит столбец «На приёмке»;
//   «!» за три дня до срока — его работу делает тон пилюли срока.

export default function TaskCard({
  task,
  section,
  stage,
  role = "none",
  kind = "none",
  dimOverdue,
  onToggleDone,
  canComplete = true,
  onOpen,
  isDragging,
  dragProps,
  justCreated,
  menuItems,
  authorName,
  people,
  refused,
  awaitingReschedule,
  unreadCount,
  checklist,
  waitsFor,
  snoozedTill,
}: {
  task: Task;
  section: Section | null;
  // Где задача стоит: отсюда берутся «не может» и «на доработке».
  stage?: TaskStage;
  // Моя роль в задаче: решает, кричать ли мне о просрочке.
  role?: MyRole;
  // Чем задача является для меня — весь вид кубика (lib/taskCardKind).
  kind?: CardKind;
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
  // Кто поставил задачу. Показывается всегда: при четырнадцати
  // постановщиках «чья это задача» — первый вопрос к кубику (21.09.2026).
  authorName?: string;
  // Строки участия задачи. На кубик идут только исполнители — со своим
  // этапом; соисполнителей и наблюдателей «выводить не надо» (21.09.2026).
  // Пока строки не доехали, ответ даёт поле `assignee`.
  people?: TaskParticipant[];
  // Кто-то из исполнителей отказался. Отдельно от stage: отказ уводит
  // задачу на приёмку (см. taskProgress.allAnswered), и без этого признака
  // «не смогли» стало бы неотличимо от «сдали работу».
  refused?: boolean;
  // Кто-то попросил перенос и ждёт решения. Доска для этого не заводит
  // своего столбца, а решать иногда нужно раньше, чем открыли карточку.
  awaitingReschedule?: boolean;
  // Сколько новых реплик в обсуждении с прошлого открытия этой карточки на
  // этом устройстве (см. useUnreadTaskComments).
  unreadCount?: number;
  // Сколько шагов чек-листа сделано (миграция 0059). Нет шагов — ничего.
  checklist?: { done: number; total: number };
  // Открытая задача, которую эта ждёт (миграция 0061). Закрыли ту — и
  // отметка уходит сама: ждать больше нечего.
  waitsFor?: { number: number; title: string };
  // До какого дня я эту задачу отложил (миграция 0049). Приходит только
  // автору и только пока отложена: на доске такая карточка видна лишь по
  // кнопке «Отложено», и без отметки её нельзя было отличить от обычной.
  snoozedTill?: string;
}) {
  const isMobile = useIsMobile();
  // Меню карточки: открыто ли и от чего. Якорь нужен только на
  // компьютере — на телефоне меню и так полоса у нижнего края, — поэтому
  // его открывает и жест, у которого прямоугольника нет.
  const [menu, setMenu] = useState<{ anchor: DOMRect | null } | null>(null);
  // Два жеста по карточке, по одному на сторону. Вправо — закрыть (это
  // делают двадцать раз в день, и обратно тем же движением). Влево — то же
  // меню, что у «⋮»: на телефоне путь до него длиннее всего, а сама точка
  // размером с горошину у края карточки.
  const hasMenu = isMobile && !!menuItems?.length;
  const swipe = useSwipeComplete({
    onComplete: isMobile && canComplete ? onToggleDone : undefined,
    // Жест открывает то же меню, что и кнопка, но без якоря: на телефоне
    // ActionMenu разворачивается полосой у нижнего края, и прямоугольник
    // ему там не нужен (см. его же isMobile-ветку).
    onActions: hasMenu ? () => setMenu({ anchor: null }) : undefined,
    enabled: isMobile && (canComplete || hasMenu),
  });

  // Полное название поверх доски — по наведению на название, если оно не
  // поместилось или у задачи есть описание. Своё окно, а не `title`:
  // системная подсказка рисуется чужим шрифтом с секундной задержкой и
  // обрезает длинный текст — ровно то, что Кирилл называет «как в
  // программе 1995 года». На телефоне наведения нет — там карточку
  // открывают.
  const titleRef = useRef<HTMLDivElement>(null);
  const peekTimer = useRef<number | null>(null);
  const [peek, setPeek] = useState<DOMRect | null>(null);
  function startPeek() {
    if (isMobile) return;
    if (peekTimer.current) window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => {
      const el = titleRef.current;
      if (!el) return;
      const cut = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
      if (cut || task.desc) setPeek(el.getBoundingClientRect());
    }, 450);
  }
  function stopPeek() {
    if (peekTimer.current) window.clearTimeout(peekTimer.current);
    peekTimer.current = null;
    setPeek(null);
  }

  // Просрочка есть или нет — вопрос к задаче; кричать о ней этому
  // человеку или нет — вопрос к его роли (см. lib/myRole). Красную рамку
  // получает тот, кого срок касается, а красную пилюлю срока — все,
  // потому что иначе «горит» ничем не отличается от «идёт». Заливки у
  // просрочки нет с 21.10.2026 (его слова: «когда просрочена задача, где я
  // ответственный или помогаю, давай уберём красную заливку»): она
  // перебивала вид задачи, и «поручили мне» переставало быть видно.
  const mineToDo = role === "executor" || role === "coexecutor";
  const late = isOverdue(task);
  const overdue = late && !dimOverdue && mineToDo;
  const dueToday = !late && isDueTodayHighlight(task) && !dimOverdue && mineToDo;
  const due = task.deadline ? dueInfo(task.deadline, { today: todayStr(), soon: isDueSoon(task) && !dimOverdue }) : null;
  // «Скоро срок» — стикером справа, а пилюля срока остаётся обычной
  // (21.10.2026, его слова: «жёлтый цвет предостережений мне не нравится,
  // давай обычный цвет, но справа стикер об опасности, чтобы привлекал
  // внимание»). Жёлтая пилюля читалась как ещё один цвет среди дат, а
  // предупреждению нужна своя форма.
  const dueSoon = due?.tone === "soon";

  // Корешок слева — тон того же отношения ко мне, что и весь кубик.
  // Просроченное, которое я поручил другому, отмечено красным корешком, но
  // доску не красит: при четырнадцати людях сплошной красный перестаёт
  // что-либо значить.
  const bar = late && kind === "outgoing" ? "late" : kind;

  // Кому поручено: исполнители со своим этапом. Пока строки участия едут
  // отдельным запросом, ответ даёт поле `assignee`.
  const executors = (people || []).filter((p) => p.role === "executor");
  const fallbackName = !executors.length && task.assignee ? withoutSelfMark(task.assignee) : "";
  // Имена — пока помещаются: два читаются, шесть превращаются в абзац.
  // Дальше только кружки, а имя — в подсказке каждого.
  const namesShown = executors.length <= 2;
  const MAX_BADGES = 6;
  const shownPeople = executors.slice(0, MAX_BADGES);
  const hidden = executors.slice(MAX_BADGES);

  const hint = CARD_KIND_HINT[kind];

  const card = (
    <div
      className={
        "task kind-" +
        kind +
        (task.status === "done" ? " done" : "") +
        (overdue ? " overdue" : "") +
        (dueToday ? " due-today" : "") +
        (isDragging ? " dragging" : "") +
        (justCreated ? " just-created" : "") +
        " role-" +
        role
      }
      data-id={task.id}
      data-role={role}
      data-kind={kind}
      ref={dragProps?.ref}
      // Свайп «сделано» на телефоне побеждает сдвиг перетаскивания: пока
      // палец ведёт карточку вбок, она и должна ехать за пальцем, а не
      // расступаться перед соседом.
      style={swipe.offset ? { transform: `translateX(${swipe.offset}px)`, transition: "none" } : dragProps?.style}
      {...dragProps?.attributes}
      {...dragProps?.listeners}
      {...swipe.handlers}
      // Обсуждение просится заранее, пока указатель на карточке: окно
      // задачи открывается уже с перепиской, а не с пустой лентой
      // (07.10.2026). pointerenter приходит и от пальца — перед касанием.
      onPointerEnter={() => prefetchComments("task", task.id)}
      onPointerDownCapture={stopPeek}
      onClick={onOpen}
    >
      <span className={"task-role-bar rb-" + bar} title={hint || (bar === "late" ? "Просрочено у того, кому поручено" : undefined)} />

      {/* Раздел — полоской у правого края, своим цветом. */}
      {section && <span className={"task-section-bar" + (section.kind === "personal" ? " personal" : "")} title={section.name} />}

      <div className="task-body">
        <div className="task-top">
          {/* Номер — чтобы задачу можно было назвать по телефону и в
              переписке одним словом (миграция 0045). Левый верхний угол —
              его место по словам Кирилла. */}
          <span className="task-num">{task.number != null ? `#${task.number}` : ""}</span>
          <div className="task-title" ref={titleRef} onPointerEnter={startPeek} onPointerLeave={stopPeek}>
            {task.title}
          </div>
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
          {isMobile && !!menuItems?.length && (
            <button
              className="task-menu-btn"
              title="Действия"
              data-task-menu={task.id}
              onClick={(e) => {
                e.stopPropagation();
                setMenu({ anchor: e.currentTarget.getBoundingClientRect() });
              }}
            >
              ⋮
            </button>
          )}
        </div>

        {/* Кто поручил → кому. Своя задача говорит о себе одним словом:
            постановщик и исполнитель там один и тот же человек, и стрелка
            от себя к себе читалась бы опечаткой. */}
        {/* Своя задача строки людей не имеет: постановщик и исполнитель
            там один и тот же человек. Её отметка «Личная задача» стоит
            внизу справа, вместе с «Помогаю» и «Наблюдаю» (14.10.2026: «все
            маркеры со значками должны располагаться в правом нижнем
            углу»). */}
        {kind === "self" ? null : (
          (authorName || executors.length > 0 || fallbackName) && (
            <div className="task-people" title={authorName ? `${authorName} → ${executors.map((p) => withoutSelfMark(p.name)).join(", ") || fallbackName || "не назначен"}` : undefined}>
              {authorName && <span className="task-from">{authorName}</span>}
              {authorName && (executors.length > 0 || fallbackName) && <span className="task-arrow">→</span>}
              {shownPeople.map((p) => (
                <PersonBadge key={p.assigneeId} name={p.name} state={personState(p)} showName={namesShown} />
              ))}
              {hidden.length > 0 && (
                <span className="pbadge-more" title={hidden.map((p) => withoutSelfMark(p.name)).join(", ")}>
                  +{hidden.length}
                </span>
              )}
              {/* Тем же кружком, что и исполнитель со строкой участия: иначе
                  одна и та же фамилия на соседних кубиках выглядела то
                  кружком, то голым цветным текстом. */}
              {fallbackName && <PersonBadge name={fallbackName} showName />}
            </div>
          )
        )}

        {(due || !!snoozedTill || !!checklist?.total || !!waitsFor || recurLabel(task) || stage === "blocked" || refused || stage === "returned" || awaitingReschedule || !!unreadCount || kind === "watch" || kind === "co" || kind === "self" || kind === "incoming") && (
          <div className="task-foot">
            {due && (
              <span className={"task-due-pill tone-" + ((dimOverdue && due.tone !== "late") || due.tone === "soon" ? "normal" : due.tone)} title={due.title}>
                <Icon name="calendar" size={12} />
                {due.text}
              </span>
            )}
            {/* Стикер — сразу справа от даты, к которой он относится
                (21.10.2026: «скоро срок разместить справа от даты дедлайна»). */}
            {dueSoon && (
              <span className="task-soon-sticker" title={due!.title + " — срок совсем скоро"}>
                <Icon name="warning" size={13} /> Скоро срок
              </span>
            )}
            {/* Сколько раз срок уже переносили (миграция 0058, предложение 5
                от 13.10.2026): задача, отложенная трижды, не должна на доске
                выглядеть поставленной вчера. Число — рядом со сроком, первый
                срок — в подсказке. */}
            {!!task.deadlineMoves && task.deadline && (
              <span
                className={"task-moves" + (task.deadlineMoves >= 3 ? " many" : "")}
                title={`Срок переносили ${task.deadlineMoves} раз${task.deadlineMoves % 10 >= 2 && task.deadlineMoves % 10 <= 4 && (task.deadlineMoves < 10 || task.deadlineMoves > 20) ? "а" : ""}${task.firstDeadline ? " — изначально " + task.firstDeadline.split("-").reverse().join(".") : ""}`}
              >
                <Icon name="reset" size={11} />
                {task.deadlineMoves}
              </span>
            )}
            {!task.deadline && task.recur !== "none" && isDueTodayHighlight(task) && (
              <span className="task-due-pill tone-today">
                <Icon name="calendar" size={12} />
                Сегодня
              </span>
            )}
            {snoozedTill && (
              <span className="task-snoozed" title="Вы отложили задачу: в этот день она вернётся на доску, и бот напомнит">
                <Icon name="clock" size={12} />
                Отложена до {snoozeDay(snoozedTill)}
              </span>
            )}
            {/* «Ждёт #12» — работу пока не начать (миграция 0061). */}
            {waitsFor && (
              <span className="task-waits" title={`Ждёт задачу #${waitsFor.number} «${waitsFor.title}»`}>
                <Icon name="clock" size={12} />
                Ждёт #{waitsFor.number}
              </span>
            )}
            {/* Шаги чек-листа «3/5» — ход работы без единого сообщения. */}
            {!!checklist?.total && (
              <span className={"task-checklist" + (checklist.done === checklist.total ? " all" : "")} title={`Чек-лист: сделано ${checklist.done} из ${checklist.total}`}>
                <Icon name="check" size={12} />
                {checklist.done}/{checklist.total}
              </span>
            )}
            {recurLabel(task) && <span className="task-recur">{recurLabel(task)}</span>}
            {/* Два состояния, которых не видно по столбцу: «В работе» стоит
                и тот, кто взялся, и тот, кто отказался, и тот, кому вернули. */}
            {(stage === "blocked" || refused) && <span className="task-state blocked">Не может</span>}
            {stage === "returned" && <span className="task-state returned">На доработке</span>}
            {/* Просьба о переносе — словом, а не значком. До 14.10.2026 здесь
                был кружок с календарём в углу, и Кирилл сказал о нём: «он
                непонятный вообще». Словом и мягкой заливкой «цвета кожи» —
                его же описание: заметно, но не тревожно, решение ждёт, а
                не горит. */}
            {awaitingReschedule && (
              <span className="task-chip reschedule" title="Исполнитель просит перенести срок — решение за постановщиком">
                Просит перенести
              </span>
            )}
            <span className="task-marks">
              {!!unreadCount && (
                <span className="task-mark unread" title={`${unreadCount} новых сообщений в обсуждении`}>
                  {unreadCount}
                </span>
              )}
              {/* Отметки отношения ко мне — цветным значком со словом, в
                  правом нижнем углу (14.10.2026: «глаз цветной, более
                  выразительный и чуть больше… и справа надпись
                  „Наблюдаю“»; у соисполнителя — «Помогаю»). */}
              {kind === "self" && (
                <span className="kind-tag kind-tag-self" title="Ваша личная задача">
                  <Icon name="user" size={15} /> Личная задача
                </span>
              )}
              {/* «Поручено мне» — словом, как у остальных видов (21.10.2026:
                  «хочу, чтобы более выделялись задачи, которые поручены мне
                  на выполнение»). Одной рамки не хватало: её надо было
                  сравнивать с соседними. */}
              {kind === "incoming" && (
                <span className="kind-tag kind-tag-in" title="Поручили вам — вы исполнитель">
                  <Icon name="inbox" size={15} /> Мне поручено
                </span>
              )}
              {kind === "co" && (
                <span className="kind-tag kind-tag-co" title="Вы соисполнитель">
                  <Icon name="users" size={15} /> Помогаю
                </span>
              )}
              {kind === "watch" && (
                <span className="kind-tag kind-tag-watch" title="Вы наблюдатель">
                  <Icon name="eye" size={15} /> Наблюдаю
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      {menu && !!menuItems?.length && <ActionMenu anchor={menu.anchor} title={task.title} items={menuItems} onClose={() => setMenu(null)} />}

      {peek && (
        <PopLayer>
          <div
            className="task-peek"
            style={{
              top: Math.min(peek.bottom + 6, window.innerHeight - 40),
              left: Math.max(8, Math.min(peek.left - 8, window.innerWidth - 380)),
            }}
          >
            <div className="task-peek-title">{task.title}</div>
            {task.desc && <div className="task-peek-desc">{task.desc}</div>}
          </div>
        </PopLayer>
      )}
    </div>
  );

  if (!isMobile) return card;

  // The swipe hint lives behind the card, so it appears from under it as
  // the card slides.
  return (
    <div
      className={
        "swipe-wrap" +
        // Куда ведут прямо сейчас: подсказки лежат друг на друге, и видна
        // должна быть та, к которой едет карточка.
        (swipe.offset > 0 ? " to-right" : swipe.offset < 0 ? " to-left" : "") +
        (swipe.armed ? " armed" : "") +
        (swipe.armedLeft ? " armed-left" : "")
      }
    >
      {/* Подсказки лежат ПОД карточкой, каждая у своего края, и проступают
          из-под неё по мере движения: жест объясняет себя сам, а не
          требует, чтобы о нём знали заранее. */}
      {(canComplete || swipe.offset > 0) && (
        <div className="swipe-hint">{task.status === "done" ? "↩ Вернуть" : "✓ Готово"}</div>
      )}
      {hasMenu && <div className="swipe-hint left">Действия ⋮</div>}
      {card}
    </div>
  );
}
