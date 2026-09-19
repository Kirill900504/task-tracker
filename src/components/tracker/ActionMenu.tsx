"use client";

import { useLayoutEffect, useRef } from "react";
import PopLayer from "./PopLayer";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import Icon, { type IconName } from "./Icon";

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
  // Значок пункта — ОТДЕЛЬНЫМ полем, а не эмодзи в начале подписи.
  //
  // «📅 Назначить встречу» — это цветная наклейка из системного шрифта
  // внутри строки, набранной шрифтом интерфейса: она другого размера,
  // другого веса и своего собственного цвета, который не меняется вместе с
  // пунктом при наведении. Значком здесь рисуется тот же контур, что и
  // везде (Icon.tsx), и выравнивается он по сетке, а не по тому, сколько
  // места занял символ.
  icon?: IconName;
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

  // Меню открывается ПОВЕРХ окна (роль человека — поверх карточки задачи),
  // и Escape должен закрыть только его: хук останавливает событие, поэтому
  // до обработчика карточки оно не дойдёт.
  useEscapeToClose(onClose);

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
  }, [anchor, isMobile, items.length]);

  return (
    <PopLayer>
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
            {item.icon && <Icon name={item.icon} size={15} />}
            <span className="export-item-label">{item.label}</span>
          </button>
        ))}
        {isMobile && (
          <button className="export-item action-sheet-cancel" onClick={onClose}>
            Отмена
          </button>
        )}
      </div>
    </PopLayer>
  );
}
