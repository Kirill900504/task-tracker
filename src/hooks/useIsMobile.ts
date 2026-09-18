"use client";

import { useSyncExternalStore } from "react";

// Одно определение «это телефон или планшет» на весь трекер.
//
// Порог был 768px — и ровно между ним и 1150px, где трёхколоночная
// раскладка схлопывается в одну, лежала дыра: на планшете и узком ноутбуке
// не было ни вкладок внизу, ни колонок — одна длинная лента, где до встреч
// надо пролистать все задачи. То есть ровно то, от чего мобильную оболочку
// и заводили. 1000px закрывает эту дыру: шире — колонки, уже — вкладки.
//
// Значение обязано совпадать с медиазапросом мобильного блока в
// tracker.css: разметка оболочки и её стили должны включаться вместе, иначе
// в полосе между порогами получится вкладочная разметка с десктопными
// отступами.
export const MOBILE_QUERY = "(max-width: 1000px)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

// useSyncExternalStore rather than an effect that copies the value into
// state: a media query IS external state, and reading it this way means the
// first client render already knows the answer instead of rendering the
// desktop tree and then correcting itself.
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    // On the server there is no viewport; the desktop tree is what gets
    // rendered into the HTML, and the client swaps it on hydration.
    () => false,
  );
}
