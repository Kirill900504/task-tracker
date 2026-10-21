"use client";

import { useLayoutEffect, type RefObject } from "react";
import { reducedMotion } from "./smoothHeight";

// Окно закрывается плавно, а не исчезает одним кадром (21.10.2026: «сделай
// так же плавно открытие и закрытие окон»).
//
// Закрывает окно РОДИТЕЛЬ, убирая его из разметки, — и окон таких три
// десятка. Задерживать каждое закрытие, пока доиграет анимация, значило бы
// научить этому каждого родителя, и через месяц новое окно снова исчезало
// бы рывком. Поэтому окно уходит слепком: в момент закрытия его копия
// встаёт на то же место и гаснет (класс .closing), а настоящее уже закрыто
// — состояние, фокус и Esc живут как раньше, ничего не ждёт анимации.
//
// Слепок — картинка, а не второе окно: без id (иначе два одинаковых id в
// документе, а по ним держатся e2e), `inert` и без указателя — нажатие
// проходит сквозь него.

export const GHOST_MS = 200; // = --win-out в tracker.css

// Слепок живёт в ЗАКРЫТОМ shadow DOM. Первая версия клала его прямо в
// документ, и на долю секунды в нём оказывалось два `.ask-modal`, два
// `.modal` и две кнопки «Отмена»: любой поиск по классу — и код страницы, и
// тринадцать e2e — находил лишнее. Из закрытого теневого дерева его не
// достаёт ни `querySelector`, ни Playwright, а рисуется он так же: стили
// документа копируются в теневое дерево одним листом и переиспользуются.
let sheet: { key: number; sheet: CSSStyleSheet } | null = null;
function documentSheet(): CSSStyleSheet | null {
  if (typeof CSSStyleSheet === "undefined" || !("replaceSync" in CSSStyleSheet.prototype)) return null;
  const sheets = Array.from(document.styleSheets);
  // Ключ — число листов: в разработке их подменяет горячая замена.
  if (sheet && sheet.key === sheets.length) return sheet.sheet;
  const text: string[] = [];
  for (const s of sheets) {
    try {
      for (const rule of Array.from(s.cssRules)) text.push(rule.cssText);
    } catch {
      /* чужой лист (шрифты с другого адреса) читать нельзя — и не нужно */
    }
  }
  const built = new CSSStyleSheet();
  built.replaceSync(text.join("\n"));
  sheet = { key: sheets.length, sheet: built };
  return built;
}

export function leaveGhost(el: HTMLElement, opts: { topLayer?: boolean } = {}) {
  if (!el.isConnected || reducedMotion()) return;
  const styles = documentSheet();
  if (!styles) return; // без теневых стилей слепок рисовать нечем — закрываем как раньше
  const ghost = el.cloneNode(true) as HTMLElement;
  const from = [el, ...el.querySelectorAll<HTMLElement>("*")];
  const scrolls = from.map((n) => n.scrollTop);
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  ghost.classList.add("closing");
  ghost.setAttribute("inert", "");
  ghost.setAttribute("aria-hidden", "true");
  // Хозяин теневого дерева не занимает места: `display:contents`.
  const host = document.createElement("div");
  host.style.display = "contents";
  host.setAttribute("aria-hidden", "true");
  // По этой метке слепок находит e2e: внутрь закрытого дерева он не заглянет.
  host.setAttribute("data-leaving-window", "");
  const root = host.attachShadow({ mode: "closed" });
  root.adoptedStyleSheets = [styles];
  root.appendChild(ghost);
  if (opts.topLayer) {
    // Окно — в верхнем слое, и слепок обязан лечь туда же: иначе окно,
    // оставшееся открытым под ним, перекрыло бы его своим затемнением.
    // Popover даёт верхний слой без ловушки фокуса и без inert для страницы.
    ghost.setAttribute("popover", "manual");
    ghost.setAttribute("open", "");
    document.body.appendChild(host);
    try {
      ghost.showPopover();
    } catch {
      /* без popover слепок просто лежит под открытыми окнами — не беда */
    }
  } else {
    el.after(host);
  }
  // Прокрутка не копируется вместе с узлом: без неё лента обсуждения в
  // слепке прыгнула бы к началу ровно в момент закрытия.
  const to = [ghost, ...ghost.querySelectorAll<HTMLElement>("*")];
  scrolls.forEach((top, i) => {
    if (top && to[i]) to[i].scrollTop = top;
  });
  setTimeout(() => host.remove(), GHOST_MS);
}

// Слепок снимается в layout-очистке: она идёт ДО того, как React вынет
// элемент из документа, — пока у него ещё есть раскладка и прокрутка
// (обычная очистка эффекта приходит уже к вынутому узлу).
export function useLeaveGhost(ref: RefObject<HTMLElement | null>, opts: { topLayer?: boolean } = {}) {
  const topLayer = !!opts.topLayer;
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (el && (!(el instanceof HTMLDialogElement) || el.open)) leaveGhost(el, { topLayer });
    };
  }, [ref, topLayer]);
}
