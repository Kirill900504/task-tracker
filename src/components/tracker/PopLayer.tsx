"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// Слой, в котором живут меню и всплывающие подсказки.
//
// Раньше каждое меню портировалось в <body> и полагалось на z-index. Это
// работало ровно до того дня, когда окна стали настоящими <dialog>: браузер
// кладёт их в ВЕРХНИЙ СЛОЙ, а он выше любого z-index, какой ни напиши. Меню,
// вызванное из окна, оказывалось под ним — не «плохо выглядело», а
// переставало нажиматься вовсе.
//
// Popover API открывает тот же верхний слой всему остальному. Слой один на
// меню целиком (подложка плюс само меню), чтобы порядок внутри оставался
// нашим, а не зависел от того, что открылось раньше.
//
// `manual` — потому что закрытием управляет компонент: у половины меню
// закрытие означает не «скрыть», а «отменить выбор и вернуть фокус».

// Куда вешать слой. Обычно — в <body>, но если сейчас открыто модальное
// окно, то ВНУТРЬ него.
//
// Причина точная и стоила часа: `showModal()` делает inert всё, что не
// лежит внутри самого окна. Меню, портированное в <body>, при этом видно —
// и оно не нажимается: браузер не отдаёт ему ни кликов, ни фокуса, а
// выглядит это как «кнопка не работает». Верхний слой тут не помогает,
// потому что inert считается по дереву документа, а не по слоям.
function layerHost(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  return dialogs.length ? dialogs[dialogs.length - 1] : document.body;
}

export default function PopLayer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Хост считается один раз, при открытии меню: перевесить слой посреди
  // жизни было бы нечем — React потерял бы состояние того, что внутри.
  const [host] = useState<HTMLElement | null>(() => (typeof document === "undefined" ? null : layerHost()));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Старый браузер без Popover API просто останется на z-index: меню
    // будет работать как раньше, а не исчезнет.
    if (typeof el.showPopover !== "function") return;
    try {
      el.showPopover();
    } catch {
      /* уже открыт — бывает при быстром переоткрытии меню */
    }
    return () => {
      try {
        if (el.isConnected && el.matches(":popover-open")) el.hidePopover();
      } catch {
        /* закрывать нечего */
      }
    };
  }, []);

  if (!host) return null;

  return createPortal(
    <div ref={ref} popover="manual" className="pop-layer">
      {children}
    </div>,
    host,
  );
}
