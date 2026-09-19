"use client";

// Конструктор панелей: три зоны, панели переставляются мышью и пальцем.
//
// Раньше это был HTML5 drag-and-drop со своими индикаторами: тонкая полоска
// перед панелью показывала, куда встанет блок, сама панель бледнела, а
// курсор рисовала операционная система. Теперь панели РАССТУПАЮТСЯ —
// соседи разъезжаются и освобождают место, — а под курсором едет плашка с
// названием (см. TrackerDnd). Отдельный индикатор после этого не нужен
// вовсе: место, которое освободилось, и есть индикатор.
//
// Логика «куда встанет» живёт в TrackerDnd, здесь остаётся разметка: зона
// принимает сброс, панель умеет быть сортируемой, порядок берётся из
// предпросмотра, пока идёт перетаскивание.
import { cloneElement, isValidElement } from "react";
import type { ReactElement } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PanelLayout } from "@/types/tracker";
import { ZONE_NAMES, usePreviewLayout } from "./dnd/TrackerDnd";
import type { ZoneName } from "./dnd/TrackerDnd";
import type { PanelDragProps } from "./PanelDragHandle";

// Названия панелей нужны одному месту — плашке, которая едет под курсором.
// Взять их из самих панелей нельзя: у календаря в заголовке месяц, у задач
// заголовка нет вовсе (на его месте кнопки и фильтры).
export const PANEL_TITLES: Record<string, string> = {
  calPanel: "Календарь",
  meetingsPanel: "Встречи",
  mainCol: "Задачи",
  weekPanel: "Неделя",
  peoplePanel: "Люди",
  ideasPanel: "Идеи и мысли",
};

function SortablePanel({ id, zone, element }: { id: string; zone: ZoneName; element: ReactElement<PanelDragProps> }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { payload: { kind: "panel", id, zone, title: PANEL_TITLES[id] ?? id }, target: { kind: "panel", id, zone } },
  });

  const injected: PanelDragProps = {
    dragHandleProps: { attributes, listeners, setActivatorNodeRef },
    isDragging,
  };

  return (
    // Обёртка, а не сама панель: ref и сдвиг нужны на элементе, который
    // двигается, а панели рисуют свой корневой div сами и ref не принимают.
    // Отступы при этом остаются на панели, так что вёрстка не меняется.
    <div
      ref={setNodeRef}
      className={"dash-slot" + (isDragging ? " dragging" : "")}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-panel-slot={id}
    >
      {isValidElement(element) ? cloneElement(element, injected) : null}
    </div>
  );
}

function Zone({ zone, ids, panels }: { zone: ZoneName; ids: string[]; panels: Record<string, ReactElement<PanelDragProps>> }) {
  const { setNodeRef, isOver } = useDroppable({ id: "zone:" + zone, data: { target: { kind: "zone", zone } } });

  return (
    <div
      ref={setNodeRef}
      id={"zone" + zone[0].toUpperCase() + zone.slice(1)}
      className={"dash-zone" + (isOver ? " drag-over" : "")}
      data-zone={zone}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ids.map((panelId) => {
          const element = panels[panelId];
          return element ? <SortablePanel key={panelId} id={panelId} zone={zone} element={element} /> : null;
        })}
      </SortableContext>
    </div>
  );
}

export default function DashboardLayout({
  layout,
  panels,
}: {
  layout: PanelLayout;
  panels: Record<string, ReactElement<PanelDragProps>>;
}) {
  // Пока панель едет, порядок берётся из предпросмотра — именно он и
  // заставляет соседей расступаться.
  const shown = usePreviewLayout() ?? layout;

  // Панель, которой нет в сохранённой раскладке, всё равно должна
  // показаться: раскладка лежит в настройках пользователя с прошлого года,
  // и новая панель иначе не появится ни у кого, кроме нового человека.
  // Добавляется в правый столбец — туда, где стоят панели-спутники.
  const placed = new Set([...shown.left, ...shown.center, ...shown.right]);
  const unplaced = Object.keys(panels).filter((id) => !placed.has(id));
  const zoneList = (zone: ZoneName) => (zone === "right" ? [...shown.right, ...unplaced] : shown[zone]).filter((id) => panels[id]);

  // Пустая боковая зона схлопывается в ноль, чтобы середина забрала ширину,
  // а не осталась пустая колонка. Но во время перетаскивания — нет: зона,
  // схлопнувшаяся до нуля, не примет сброс, и панель некуда было бы
  // вернуть. Это и был главный источник «перетащил и не могу вернуть», от
  // которого спасала кнопка «Сбросить расположение».
  const dragging = usePreviewLayout() !== null;
  const width = (zone: ZoneName, size: string) => (zoneList(zone).length ? size : dragging ? "120px" : "0px");
  const gridTemplateColumns = [width("left", "300px"), "1fr", width("right", "320px")].join(" ");

  return (
    <div className={"layout" + (dragging ? " layout-dragging" : "")} id="layoutGrid" style={{ gridTemplateColumns }}>
      {ZONE_NAMES.map((zone) => (
        <Zone key={zone} zone={zone} ids={zoneList(zone)} panels={panels} />
      ))}
    </div>
  );
}
