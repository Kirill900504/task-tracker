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
// события ближайшим — а у нас карточки лежат ВНУТРИ панелей, и идею таскают
// из панели «Мысли» в панель «Календарь». Два контекста означали бы, что
// либо панели, либо карточки привязаны не туда; разделять их нельзя в
// принципе.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { PanelLayout } from "@/types/tracker";

export type ZoneName = keyof PanelLayout;
export const ZONE_NAMES: ZoneName[] = ["left", "center", "right"];

// Что именно едет под курсором. `kind` — единственное, что маршрутизирует
// обработку: элементы регистрируют его в `data`, а весь разбор живёт здесь,
// а не размазан по шести компонентам, как было с dataTransfer.
export type DragPayload =
  | { kind: "panel"; id: string; zone: ZoneName; title: string }
  | { kind: "task"; id: string; term: string }
  | { kind: "idea"; id: string; text: string }
  | { kind: "meeting"; id: string; title: string };

export type DropTarget =
  | { kind: "zone"; zone: ZoneName }
  | { kind: "panel"; id: string; zone: ZoneName }
  | { kind: "task-column"; term: string }
  | { kind: "task"; id: string; term: string }
  | { kind: "day"; date: string }
  | { kind: "meetings" };

// Что несут и над чем оно сейчас висит. Второе нужно панелям, чтобы
// показать перестановку ДО того, как её отпустили: место освобождается
// заранее, иначе «конструктора» не получается.
type DragState = { active: DragPayload | null; over: DropTarget | null };

const DragStateContext = createContext<DragState>({ active: null, over: null });
export const useDragState = () => useContext(DragStateContext);

// Раскладка, которую видно ПРЯМО СЕЙЧАС: во время перетаскивания это
// предпросмотр (панели уже расступились), в покое — сохранённая. Отдаётся
// отдельным контекстом, чтобы DashboardLayout не решал, чью версию рисовать.
const PreviewLayoutContext = createContext<PanelLayout | null>(null);
export const usePreviewLayout = () => useContext(PreviewLayoutContext);

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

function payloadOf(data: unknown): DragPayload | null {
  const value = (data as { current?: { payload?: DragPayload } } | undefined)?.current?.payload;
  return value ?? null;
}

function targetOf(data: unknown): DropTarget | null {
  const value = (data as { current?: { target?: DropTarget } } | undefined)?.current?.target;
  return value ?? null;
}

// Панель переезжает в предпросмотре: убрать отовсюду, вставить в целевую
// зону перед той панелью, над которой курсор (или в конец, если курсор над
// пустым местом зоны).
function movePanel(layout: PanelLayout, id: string, target: DropTarget): PanelLayout {
  const zone: ZoneName | null = target.kind === "zone" ? target.zone : target.kind === "panel" ? target.zone : null;
  if (!zone) return layout;

  const next: PanelLayout = {
    left: layout.left.filter((x) => x !== id),
    center: layout.center.filter((x) => x !== id),
    right: layout.right.filter((x) => x !== id),
  };
  const list = next[zone];
  const before = target.kind === "panel" && target.id !== id ? list.indexOf(target.id) : -1;
  list.splice(before === -1 ? list.length : before, 0, id);
  return next;
}

function sameLayout(a: PanelLayout, b: PanelLayout) {
  return ZONE_NAMES.every((zone) => a[zone].length === b[zone].length && a[zone].every((id, i) => b[zone][i] === id));
}

export default function TrackerDnd({
  layout,
  onLayoutChange,
  renderOverlay,
  children,
}: {
  layout: PanelLayout;
  onLayoutChange: (next: PanelLayout) => void;
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
  const [preview, setPreview] = useState<PanelLayout | null>(null);

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
    const payload = payloadOf(event.active.data);
    setActive(payload);
    if (payload?.kind === "panel") setPreview(layout);
  }

  function handleDragOver(event: DragOverEvent) {
    const payload = payloadOf(event.active.data);
    const target = event.over ? targetOf(event.over.data) : null;
    setOver(target);
    if (payload?.kind !== "panel" || !target) return;
    setPreview((current) => {
      const base = current ?? layout;
      const next = movePanel(base, payload.id, target);
      // Тот же порядок — та же ссылка: иначе каждое движение мыши
      // перерисовывало бы все панели заново.
      return sameLayout(base, next) ? base : next;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const payload = payloadOf(event.active.data);
    const target = event.over ? targetOf(event.over.data) : null;

    if (payload?.kind === "panel") {
      // Предпросмотр уже показывает результат — его и сохраняем. Он же
      // единственный, кто знает, куда панель доехала: `over` в момент
      // отпускания может быть и пустой зоной, и соседней панелью.
      const next = preview ?? layout;
      setActive(null);
      setOver(null);
      setPreview(null);
      if (!sameLayout(next, layout)) onLayoutChange(next);
      return;
    }

    setActive(null);
    setOver(null);
    setPreview(null);
    if (!payload || !target) return;
    for (const handle of handlers.current.get(payload.kind) ?? []) handle(payload.id, target);
  }

  function handleDragCancel() {
    setActive(null);
    setOver(null);
    setPreview(null);
  }

  const dragState = useMemo(() => ({ active, over }), [active, over]);

  return (
    <DndContext
      sensors={sensors}
      // pointerWithin, а не «пересечение прямоугольников»: панели большие и
      // вложены друг в друга (карточка внутри колонки внутри панели), и
      // пересечение выбирало бы самый большой, а не тот, куда смотрит курсор.
      collisionDetection={pointerWithin}
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
        <DragStateContext.Provider value={dragState}>
          <PreviewLayoutContext.Provider value={preview}>{children}</PreviewLayoutContext.Provider>
        </DragStateContext.Provider>
      </HandlersContext.Provider>
      {/* Поднятый блок рисуется ЗДЕСЬ, над всем деревом, — поэтому его не
          обрезает ни панель с overflow, ни колонка. */}
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.3,1)" }}>
        {active && renderOverlay ? renderOverlay(active) : null}
      </DragOverlay>
    </DndContext>
  );
}
