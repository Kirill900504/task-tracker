"use client";

// Port of the "panel constructor" from legacy-tracker.js (currentPanelLayout/
// applyPanelLayout/savePanelLayout/getPanelAfterElement/updatePanelDropIndicator/
// setupPanelZoneDrop) — dragging whole panels (by their PanelDragHandle)
// between and within the three layout zones. Each managed child element
// gets its drag-related props injected via cloneElement rather than
// threaded through props by the caller, so NewTracker can build the
// `panels` map without knowing about drag state at all.
import { cloneElement, isValidElement, useRef, useState } from "react";
import type { DragEvent, ReactElement, RefObject } from "react";
import type { PanelLayout } from "@/types/tracker";
import { getDragAfterElement } from "@/lib/dndDom";
import type { PanelDragProps } from "./PanelDragHandle";

type ZoneName = keyof PanelLayout;
const ZONE_NAMES: ZoneName[] = ["left", "center", "right"];

export default function DashboardLayout({
  layout,
  onLayoutChange,
  panels,
  hiddenPanels = [],
}: {
  layout: PanelLayout;
  onLayoutChange: (next: PanelLayout) => void;
  panels: Record<string, ReactElement<PanelDragProps>>;
  // Panels toggled off from the header (calendar/ideas). Port of legacy's
  // updateLayoutColumns(): a hidden panel is not rendered, and a side zone
  // left with nothing visible collapses to 0px so the middle column takes
  // the freed width instead of leaving a blank gutter.
  hiddenPanels?: string[];
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<{ zone: ZoneName; beforeId: string | null } | null>(null);

  const leftRef = useRef<HTMLDivElement | null>(null);
  const centerRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const zoneRefs: Record<ZoneName, RefObject<HTMLDivElement | null>> = { left: leftRef, center: centerRef, right: rightRef };

  function handleDragOver(e: DragEvent<HTMLDivElement>, zone: ZoneName) {
    if (!e.dataTransfer.types.includes("application/x-panel-id")) return;
    e.preventDefault();
    const container = zoneRefs[zone].current;
    const after = container ? getDragAfterElement(container, e.clientY, ".dash-panel:not(.dragging)") : null;
    setIndicator({ zone, beforeId: after?.dataset.panelId ?? null });
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>, zone: ZoneName) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIndicator((cur) => (cur?.zone === zone ? null : cur));
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, zone: ZoneName) {
    const id = e.dataTransfer.getData("application/x-panel-id");
    setIndicator(null);
    if (!id) return;
    e.preventDefault();
    const container = zoneRefs[zone].current;
    const after = container ? getDragAfterElement(container, e.clientY, ".dash-panel:not(.dragging)") : null;

    const next: PanelLayout = {
      left: layout.left.filter((x) => x !== id),
      center: layout.center.filter((x) => x !== id),
      right: layout.right.filter((x) => x !== id),
    };
    const targetList = next[zone];
    const insertAt = after ? targetList.indexOf(after.dataset.panelId as string) : -1;
    targetList.splice(insertAt === -1 ? targetList.length : insertAt, 0, id);
    onLayoutChange(next);
  }

  const visibleIn = (zone: ZoneName) => layout[zone].filter((id) => !hiddenPanels.includes(id) && panels[id]);
  const gridTemplateColumns = [visibleIn("left").length ? "300px" : "0px", "1fr", visibleIn("right").length ? "320px" : "0px"].join(" ");

  return (
    <div className="layout" id="layoutGrid" style={{ gridTemplateColumns }}>
      {ZONE_NAMES.map((zone) => (
        <div
          key={zone}
          ref={zoneRefs[zone]}
          id={"zone" + zone[0].toUpperCase() + zone.slice(1)}
          className={"dash-zone" + (indicator?.zone === zone && indicator.beforeId === null ? " drag-indicator-end" : "") + (indicator?.zone === zone ? " drag-over" : "")}
          data-zone={zone}
          onDragOver={(e) => handleDragOver(e, zone)}
          onDragLeave={(e) => handleDragLeave(e, zone)}
          onDrop={(e) => handleDrop(e, zone)}
        >
          {layout[zone].map((panelId) => {
            const el = panels[panelId];
            if (!el || !isValidElement(el) || hiddenPanels.includes(panelId)) return null;
            const injectedProps: PanelDragProps = {
              dragHandleProps: {
                onDragStart: (e: DragEvent) => {
                  e.dataTransfer.setData("application/x-panel-id", panelId);
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingId(panelId);
                },
                onDragEnd: () => {
                  setDraggingId(null);
                  setIndicator(null);
                },
              },
              isDragging: draggingId === panelId,
              dropIndicatorBefore: indicator?.zone === zone && indicator.beforeId === panelId,
            };
            return cloneElement(el, { key: panelId, ...injectedProps });
          })}
        </div>
      ))}
    </div>
  );
}
