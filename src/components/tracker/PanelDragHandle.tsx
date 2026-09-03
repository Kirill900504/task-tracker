"use client";

import type { DragEvent } from "react";

export interface PanelDragHandleProps {
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}

// Shared shape DashboardLayout injects into whichever panel component it's
// currently rendering (via cloneElement) — each panel declares these as
// optional props so it type-checks both when NewTracker first constructs it
// (without them) and after DashboardLayout clones it (with them filled in).
export interface PanelDragProps {
  dragHandleProps?: PanelDragHandleProps;
  isDragging?: boolean;
  dropIndicatorBefore?: boolean;
}

const NOOP_DRAG_HANDLE: PanelDragHandleProps = { onDragStart: () => {}, onDragEnd: () => {} };
export function resolveDragHandleProps(props?: PanelDragHandleProps): PanelDragHandleProps {
  return props ?? NOOP_DRAG_HANDLE;
}

// Rendered as the first child of every panel's .dash-panel-head, matching
// trackerMarkup.ts exactly — the panel constructor (DashboardLayout) drags
// the whole .dash-panel by this handle, not the panel body.
export default function PanelDragHandle({ onDragStart, onDragEnd }: PanelDragHandleProps) {
  return (
    <span className="dash-drag-handle" draggable title="Перетащить панель" onDragStart={onDragStart} onDragEnd={onDragEnd}>
      ⠿⠿
    </span>
  );
}
