"use client";

// Одно перетаскивание на весь трекер.
//
// 19.09.2026 Кирилл посмотрел на то, что было, и назвал вещи своими именами:
// «зажимающейся ладонью как на windows 1995, зажимая кулак перетаскивать
// почти прозрачную тень выделенного блока», «запрещающий знак в местах куда
// перенести нельзя… что нет более современного решения?». Всё перечисленное
// рисует не трекер — это встроенный в браузер HTML5 drag-and-drop: призрак
// отрисовывает операционная система, курсор с перечёркнутым кругом тоже она,
// соседние блоки не отзываются никак, а на телефоне этого нет вовсе (отсюда
// и кнопки-дублёры в каждом меню).
//
// Поэтому перетаскивание переехало на dnd-kit: обычные pointer-события,
// никакого dataTransfer, никакого системного курсора. Что это даёт на
// экране:
//   — блок поднимается ПОД КУРСОР целиком (DragOverlay), а не бледнеет;
//   — на его месте остаётся пунктирный след, и соседи расступаются, уступая
//     место, — ровно «как конструктор», о котором он и просил;
//   — «сюда нельзя» показывается тем, что место не уступается, а не
//     перечёркнутым кругом;
//   — то же самое работает пальцем на телефоне.
//
// Контекст один на всё, и это не лень. Вложенные DndContext перехватывают
// события ближайшим — а мысль таскают из панели «Мысли» в столбец задач и
// на день календаря. Два контекста означали бы, что половина переносов
// привязана не туда.
//
// Панели здесь больше не ездят. Конструктор зон убран целиком по слову
// Кирилла 19.09.2026: «первым делом убираем возможность переносить блоки,
// они всё же должны быть статичны». Раскладка теперь жёсткая (см.
// DashboardLayout), а перетаскивание осталось тому, ради чего оно и
// нужно, — работе: карточкам, мыслям и встречам.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { KanbanColumn } from "@/lib/kanban";

// Что именно едет под курсором. `kind` — единственное, что маршрутизирует
// обработку: элементы регистрируют его в `data`, а весь разбор живёт здесь,
// а не размазан по шести компонентам, как было с dataTransfer.
export type DragPayload =
  | { kind: "task"; id: string; column: KanbanColumn }
  | { kind: "idea"; id: string; text: string }
  | { kind: "meeting"; id: string; title: string };

export type DropTarget =
  | { kind: "task-column"; column: KanbanColumn }
  | { kind: "task"; id: string; column: KanbanColumn }
  | { kind: "day"; date: string }
  | { kind: "meetings" };

// Что несут и над чем оно сейчас висит. Второе нужно столбцам задач, чтобы
// показать перестановку ДО того, как карточку отпустили: место
// освобождается заранее, иначе «расступаются» не получается.
type DragState = { active: DragPayload | null; over: DropTarget | null };

const DragStateContext = createContext<DragState>({ active: null, over: null });
export const useDragState = () => useContext(DragStateContext);

// Кто разбирает сброс. Обработчик живёт там же, где данные: задачи знает
// панель задач, мысли — панель мыслей. Передавать их пропсами через
// NewTracker значило бы протащить порядок задач и правила переноса через
// компонент, которому до них дела нет.
type DropHandler = (id: string, target: DropTarget) => void;
const HandlersContext = createContext<((kind: DragPayload["kind"], fn: DropHandler) => () => void) | null>(null);

export function useDropHandler(kind: DragPayload["kind"], fn: DropHandler) {
  const register = useContext(HandlersContext);
  const latest = useRef(fn);
  // Обновляется в эффекте, а не в теле: правило React-компилятора запрещает
  // менять то, что уже захвачено хуком, посреди отрисовки.
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => register?.(kind, (id, target) => latest.current(id, target)), [register, kind]);
}

// Карточку тянут за неё саму — но внутри неё живут кнопки, галочка
// «сделано» и поле правки текста. Без этой проверки выделение текста мышью
// превращалось бы в перетаскивание, а нажатие на галочку — в поднятие
// карточки: сенсор считает движением ЛЮБОЕ смещение на шесть пикселей,
// откуда бы оно ни началось.
// `[role="button"]` сюда добавлять нельзя, хотя и просится: этот самый role
// dnd-kit вешает на КАЖДЫЙ перетаскиваемый элемент — и проверка запрещала бы
// брать то, ради чего она написана. Мысли так и не брались, пока это не
// выяснилось.
const INTERACTIVE = 'button, input, textarea, select, a, [contenteditable="true"], .check, .idea-flag, .idea-del';

class CardPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }) => {
        if (!event.isPrimary || event.button !== 0) return false;
        const target = event.target as HTMLElement | null;
        return !target?.closest(INTERACTIVE);
      },
    },
  ];
}

// Чем считать «вот сюда».
//
// Для зон — по указателю: панели, дни календаря и списки большие, вложены
// друг в друга, и пересечение прямоугольников выбрало бы самый крупный, а
// не тот, куда смотрит курсор.
//
// Для карточки, которую переставляют в СВОЁМ столбце, по указателю нельзя:
// соседи в этот момент сдвинуты трансформацией, силуэт карточки остаётся на
// прежнем месте, и под курсором регулярно оказывается он сам — «перенеси
// меня на меня же». Именно так перестановка внутри столбца молча
// переставала работать. Здесь работает близость центров, считанная по
// фактическим (уже сдвинутым) прямоугольникам, и только среди карточек и
// столбцов — иначе ближайшим центром окажется клетка календаря.
function trackerCollisions(args: Parameters<typeof pointerWithin>[0]) {
  const pointer = pointerWithin(args);
  const payload = payloadOf(args.active.data);
  if (payload?.kind !== "task") return pointer;

  // День календаря выигрывает, если курсор прямо над ним: задача,
  // брошенная на дату, становится встречей.
  const overDay = pointer.find((hit) => {
    const container = args.droppableContainers.find((c) => c.id === hit.id);
    return targetOf(container?.data)?.kind === "day";
  });
  if (overDay) return [overDay];

  // Сначала решается СТОЛБЕЦ — по указателю, потому что столбец под
  // курсором это ровно то, куда человек целится. И только внутри него
  // ищется карточка, рядом с которой встать.
  //
  // Порядок именно такой, и оба шага обязательны. Если искать карточку
  // сразу среди всех, ближайшей к курсору окажется соседка из ИСХОДНОГО
  // столбца — и перенос в пустой столбец не сработает никогда. Если же
  // брать только столбец, перестановка внутри списка перестанет работать:
  // его центр всегда ближе, чем центр любой карточки.
  const columnHit = pointer.find((hit) => {
    const container = args.droppableContainers.find((c) => c.id === hit.id);
    return targetOf(container?.data)?.kind === "task-column";
  });
  if (!columnHit) return pointer;

  const columnTarget = targetOf(args.droppableContainers.find((c) => c.id === columnHit.id)?.data);
  const column = columnTarget?.kind === "task-column" ? columnTarget.column : null;
  const cards = args.droppableContainers.filter((c) => {
    const target = targetOf(c.data);
    return c.id !== args.active.id && target?.kind === "task" && target.column === column;
  });
  const nearestCard = cards.length ? closestCenter({ ...args, droppableContainers: cards }) : [];
  return nearestCard.length ? nearestCard : [columnHit];
}

function payloadOf(data: unknown): DragPayload | null {
  const value = (data as { current?: { payload?: DragPayload } } | undefined)?.current?.payload;
  return value ?? null;
}

function targetOf(data: unknown): DropTarget | null {
  const value = (data as { current?: { target?: DropTarget } } | undefined)?.current?.target;
  return value ?? null;
}

export default function TrackerDnd({
  renderOverlay,
  children,
}: {
  renderOverlay?: (active: DragPayload) => ReactNode;
  children: ReactNode;
}) {
  // Обработчиков на один вид может быть несколько: задачу бросают и в
  // столбец (панель задач), и на день календаря (панель календаря). Каждый
  // смотрит на цель и берётся только за свою — это и есть причина, по
  // которой они живут в панелях, а не одним разбором здесь.
  const handlers = useRef(new Map<string, Set<DropHandler>>());
  const register = useCallback((kind: DragPayload["kind"], fn: DropHandler) => {
    const set = handlers.current.get(kind) ?? new Set<DropHandler>();
    set.add(fn);
    handlers.current.set(kind, set);
    return () => {
      set.delete(fn);
    };
  }, []);

  const [active, setActive] = useState<DragPayload | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);

  // Порог в 6 пикселей — это разница между «нажал» и «потянул». Без него
  // каждое нажатие на ручку или карточку начинало бы перетаскивание, и
  // обычный щелчок по задаче перестал бы открывать её.
  //
  // На телефоне порог другой — задержка: палец на экране сначала может
  // означать прокрутку, и 220 мс отделяют «веду список» от «беру блок».
  const sensors = useSensors(
    useSensor(CardPointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActive(payloadOf(event.active.data));
  }

  function handleDragOver(event: DragOverEvent) {
    setOver(event.over ? targetOf(event.over.data) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const payload = payloadOf(event.active.data);
    const target = event.over ? targetOf(event.over.data) : null;
    setActive(null);
    setOver(null);
    if (!payload || !target) return;
    for (const handle of handlers.current.get(payload.kind) ?? []) handle(payload.id, target);
  }

  function handleDragCancel() {
    setActive(null);
    setOver(null);
  }

  const dragState = useMemo(() => ({ active, over }), [active, over]);

  return (
    <DndContext
      sensors={sensors}
      // pointerWithin, а не «пересечение прямоугольников»: панели большие и
      // вложены друг в друга (карточка внутри колонки внутри панели), и
      // пересечение выбирало бы самый большой, а не тот, куда смотрит курсор.
      collisionDetection={trackerCollisions}
      // Автопрокрутка нужна (столбец задач длиннее экрана, и карточку носят
      // вниз), но по умолчанию она включается за четверть экрана до края —
      // то есть страница едет, когда человек всего лишь ведёт карточку из
      // правой колонки в левую. Под курсором в этот момент оказывается не
      // то, на что он целился. Порог в одну десятую оставляет прокрутку
      // там, где она действительно нужна: у самого края.
      autoScroll={{ threshold: { x: 0.1, y: 0.1 }, acceleration: 8 }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <HandlersContext.Provider value={register}>
        <DragStateContext.Provider value={dragState}>{children}</DragStateContext.Provider>
      </HandlersContext.Provider>
      {/* Поднятый блок рисуется ЗДЕСЬ, над всем деревом, — поэтому его не
          обрезает ни панель с overflow, ни колонка. */}
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.3,1)" }}>
        {active && renderOverlay ? renderOverlay(active) : null}
      </DragOverlay>
    </DndContext>
  );
}
