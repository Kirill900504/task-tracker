"use client";

import { useSyncExternalStore } from "react";

// Одно определение «это телефон» на весь трекер.
//
// Порог опускался дважды, и оба раза по одной причине — между ним и
// раскладкой окна лежала полоса, в которой трекер не был ни тем, ни
// другим. Сначала 768 против 1150 у колонок: на планшете не было ни
// вкладок внизу, ни колонок, а одна длинная лента, где до встреч надо
// пролистать все задачи. Потом 1000 — и в эту цифру упёрся сам Кирилл
// 20.09.2026: «на каком-то этапе сжатия я заметил, что приложение для ПК
// переделывается под мобильную версию, а есть ли более эффективные
// альтернативы сжатия, чтобы на более читабельную версию для ПК просто
// перестраивалось». Он прав: 1000px — это окно, развёрнутое на половину
// обычного монитора, то есть самый обычный способ работать в двух окнах,
// и мышь с клавиатурой при этом никуда не делись.
//
// Теперь вкладки начинаются там, где колонок действительно не осталось:
// 800px. Полосы без раскладки при этом не возникло — между 800 и 1320
// окно перестраивается ступенями (см. «Ступени сжатия окна» в
// tracker.css): три колонки → две → одна, с уходом наименее нужного.
//
// Значение обязано совпадать с медиазапросом мобильного блока в
// tracker.css: разметка оболочки и её стили должны включаться вместе, иначе
// в полосе между порогами получится вкладочная разметка с десктопными
// отступами.
export const MOBILE_QUERY = "(max-width: 800px)";

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
