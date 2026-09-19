"use client";

import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import Icon from "./Icon";

export interface PanelDragHandleProps {
  attributes?: DraggableAttributes;
  listeners?: SyntheticListenerMap;
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
}

// Shared shape DashboardLayout injects into whichever panel component it's
// currently rendering (via cloneElement) — each panel declares these as
// optional props so it type-checks both when NewTracker first constructs it
// (without them) and after DashboardLayout clones it (with them filled in).
export interface PanelDragProps {
  dragHandleProps?: PanelDragHandleProps;
  isDragging?: boolean;
}

const NOOP_DRAG_HANDLE: PanelDragHandleProps = {};
export function resolveDragHandleProps(props?: PanelDragHandleProps): PanelDragHandleProps {
  return props ?? NOOP_DRAG_HANDLE;
}

// Ручка панели — первая в её шапке. Тянется за неё вся панель, а не тело:
// внутри панели живут свои перетаскивания (задачи, мысли), и панель,
// которую можно схватить где угодно, отняла бы их у карточек.
//
// Шесть точек были набраны шрифтом («⠿⠿» — символы Брайля), и рисовала их
// система: на одной машине это ровные точки, на другой — крестик в рамке.
// Теперь это тот же контурный значок, что и всё остальное в трекере
// (правило про «чужой шрифт и чужая система» в CLAUDE.md).
export default function PanelDragHandle({ attributes, listeners, setActivatorNodeRef }: PanelDragHandleProps) {
  return (
    <span
      className="dash-drag-handle"
      ref={setActivatorNodeRef}
      title="Перетащить панель"
      aria-label="Перетащить панель"
      {...attributes}
      {...listeners}
    >
      <Icon name="grip" size={14} />
    </span>
  );
}
