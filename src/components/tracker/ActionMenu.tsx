"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/useIsMobile";

// The small menu that hangs off a card's «⋯» button. Everything a card can
// do that isn't worth a permanent button lives here — and on a phone it is
// what replaces dragging, which no touch screen has ever supported.
//
// Two shapes, one component: a dropdown next to the button on the desktop,
// a sheet along the bottom edge on a phone, where the thumb is and where a
// dropdown anchored to a 20px icon would be a lottery.

export type ActionMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
};

export default function ActionMenu({
  anchor,
  title,
  items,
  onClose,
}: {
  // Where the button that opened it is. Unused by the phone's sheet.
  anchor: DOMRect | null;
  title?: string;
  items: ActionMenuItem[];
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Placed after measuring, like MeetingChip's tooltip: a menu opened from a
  // card near the bottom of the list has to flip above its button instead of
  // running off the screen.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (isMobile || !el || !anchor) return;
    let top = anchor.bottom + 6;
    if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, anchor.top - el.offsetHeight - 6);
    el.style.top = top + "px";
    el.style.right = Math.max(8, window.innerWidth - anchor.right) + "px";
  }, [anchor, isMobile]);

  return createPortal(
    <>
      <div className={"export-backdrop" + (isMobile ? " sheet-backdrop" : "")} onClick={onClose} />
      <div
        ref={menuRef}
        className={"export-menu action-menu" + (isMobile ? " action-sheet" : "")}
        style={isMobile ? undefined : { top: -9999, right: 8 }}
      >
        {title && <div className="action-menu-title">{title}</div>}
        {items.map((item) => (
          <button
            key={item.id}
            className="export-item"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
        {isMobile && (
          <button className="export-item action-sheet-cancel" onClick={onClose}>
            Отмена
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}
