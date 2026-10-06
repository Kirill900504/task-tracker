"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import PopLayer from "./PopLayer";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import Icon, { type IconName } from "./Icon";
import { matchesPerson } from "@/lib/personSearch";

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
  searchPlaceholder,
}: {
  // Where the button that opened it is. Unused by the phone's sheet.
  anchor: DOMRect | null;
  title?: string;
  items: ActionMenuItem[];
  onClose: () => void;
  // Строка поиска над пунктами — для меню, где пункты это люди («+
  // добавить» у готовой задачи). Совпадение то же, что у остальных списков
  // людей (lib/personSearch). Пункты с id, начинающимся на «new-», в поиске
  // не участвуют и видны всегда: «+ новый человек» нужен как раз тогда,
  // когда поиск никого не нашёл.
  searchPlaceholder?: string;
}) {
  const isMobile = useIsMobile();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const shownItems = searchPlaceholder && query.trim()
    ? items.filter((item) => item.id.startsWith("new-") || matchesPerson(item.label, query))
    : items;

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
    // Потолок — экран. Без него «Кого добавить» из пятнадцати имён уходило
    // за нижний край, и последних людей было не выбрать вовсе (отзыв
    // Витовского 25.09.2026: «список выходит за рамки экрана»). Дальше —
    // прокрутка внутри меню.
    el.style.maxHeight = window.innerHeight - 16 + "px";
    let top = anchor.bottom + 6;
    if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, anchor.top - el.offsetHeight - 6);
    if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - el.offsetHeight);
    el.style.top = top + "px";
    el.style.right = Math.max(8, window.innerWidth - anchor.right) + "px";
  }, [anchor, isMobile, shownItems.length]);

  // Клавиатура. Меню живёт в верхнем слое, а не рядом с кнопкой, которая его
  // открыла, — Tab от неё до пунктов не доходит вовсе, и выбрать роль без
  // мыши было нельзя (QA-проход 06.10.2026). Поэтому фокус встаёт на первый
  // пункт сам, а стрелки ходят по пунктам. Где есть строка поиска, фокус её.
  useEffect(() => {
    if (isMobile || searchPlaceholder) return;
    menuRef.current?.querySelector<HTMLButtonElement>(".export-item")?.focus();
  }, [isMobile, searchPlaceholder]);

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(".export-item") || []);
    if (!buttons.length) return;
    e.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  }
  return (
    <PopLayer>
      <div className={"export-backdrop" + (isMobile ? " sheet-backdrop" : "")} onClick={onClose} />
      <div
        ref={menuRef}
        className={"export-menu action-menu" + (isMobile ? " action-sheet" : "")}
        style={isMobile ? undefined : { top: -9999, right: 8 }}
        role="menu"
        onKeyDown={onMenuKey}
      >
        {title && <div className="action-menu-title">{title}</div>}
        {searchPlaceholder && (
          <input
            className="people-search action-menu-search"
            type="search"
            autoFocus={!isMobile}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Один найденный — Enter выбирает его.
              if (e.key !== "Enter") return;
              e.preventDefault();
              const real = shownItems.filter((item) => !item.id.startsWith("new-"));
              if (real.length === 1) {
                onClose();
                real[0].onSelect();
              }
            }}
            aria-label={searchPlaceholder}
          />
        )}
        {shownItems.map((item) => (
          <button
            key={item.id}
            className="export-item"
            role="menuitem"
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
