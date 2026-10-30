"use client";

import { useEffect } from "react";
import { placeTip } from "@/lib/titleTips";

// Подсказки при наведении — свои, а не системные.
//
// У трекера около двухсот кнопок с атрибутом `title`, и каждую из них
// подписывал Windows: серый прямоугольник чужим шрифтом, через секунду
// задержки, поверх тёмного интерфейса — ровно то, что Кирилл называет «как
// в Windows 95» (29.10.2026). Переписывать двести мест на компонент значило
// бы двести мест, где его забудут в следующий раз, поэтому подмена одна и
// общая: наведение мышью забирает `title` у элемента (так браузер свою
// подсказку не покажет) и рисует его текст своей плашкой; уход мыши
// возвращает атрибут на место. Писать в разметке по-прежнему надо просто
// `title` — всё остальное происходит здесь.
//
// Что легко сломать:
// *Имя кнопки для чтения с экрана.* У кнопки-значка без текста `title` и
// есть её имя (и по нему же её находят e2e: getByRole … name). Пока
// атрибут снят, имя держит временный `aria-label`, и снимается он вместе с
// возвратом `title`.
// *Возврат не перетирает новое.* Если React за время наведения поставил
// элементу новый `title` (подпись зависит от состояния), он и остаётся.
// *Только мышь.* На телефоне наведения нет, а длинное нажатие занято
// перетаскиванием и меню — там всё как было.
// *Верхний слой.* Плашка — popover: окна трекера — настоящие <dialog>, и
// всё, что не в верхнем слое, рисуется под ними. Каждый показ заново
// открывает popover, чтобы он лёг выше окна, открытого после него.

const SHOW_DELAY = 450;
// Переход с одной кнопки на соседнюю — без новой задержки, как в системных
// меню: плашка уже на экране, человек водит мышью по ряду кнопок.
const SWITCH_WINDOW = 300;

type Held = { el: HTMLElement; text: string; addedLabel: boolean };

export default function TitleTips() {
  useEffect(() => {
    const tip = document.createElement("div");
    tip.className = "title-tip";
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("aria-hidden", "true");
    const canPop = typeof tip.showPopover === "function";
    if (canPop) tip.setAttribute("popover", "manual");
    document.body.appendChild(tip);

    let held: Held | null = null;
    let timer = 0;
    let shown = false;
    let hiddenAt = 0;

    function release() {
      if (!held) return;
      const { el, text, addedLabel } = held;
      if (!el.hasAttribute("title")) el.setAttribute("title", text);
      if (addedLabel && el.getAttribute("aria-label") === text) el.removeAttribute("aria-label");
      held = null;
    }

    // Убрать плашку, но атрибут держать снятым, пока мышь на элементе:
    // иначе после нажатия, на том же месте, браузер показал бы свою.
    function conceal() {
      window.clearTimeout(timer);
      if (shown) {
        shown = false;
        hiddenAt = Date.now();
        tip.classList.remove("on");
        if (canPop) {
          try {
            tip.hidePopover();
          } catch {
            /* уже скрыт */
          }
        }
      }
    }

    function hide() {
      conceal();
      release();
    }

    function show() {
      if (!held || !held.el.isConnected) return hide();
      tip.textContent = held.text;
      tip.dataset.side = "";
      if (canPop) {
        try {
          // Переоткрыть — значит лечь выше всего, что открылось с прошлого раза.
          if (tip.matches(":popover-open")) tip.hidePopover();
          // И лечь ВНУТРЬ открытого окна, если оно есть: popover из inert-
          // поддерева (всё вне модального <dialog>) Chrome не рисует вовсе,
          // хотя считает открытым и ставит в верхний слой. Та же причина, по
          // которой PopLayer вешает меню в окно (layerHost там).
          const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
          const host = dialogs.length ? dialogs[dialogs.length - 1] : document.body;
          if (tip.parentNode !== host) host.appendChild(tip);
          tip.showPopover();
        } catch {
          /* уже открыт — бывает при быстрой смене кнопок */
        }
      } else if (!tip.isConnected) {
        // Без Popover API плашка живёт на z-index; окно, в котором она
        // лежала, могли закрыть вместе с ней.
        document.body.appendChild(tip);
      }
      tip.classList.add("measure");
      const r = held.el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      const p = placeTip(
        { left: r.left, top: r.top, width: r.width, height: r.height },
        { width: t.width, height: t.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      tip.style.left = `${p.left}px`;
      tip.style.top = `${p.top}px`;
      tip.dataset.side = p.side;
      tip.classList.remove("measure");
      tip.classList.add("on");
      shown = true;
    }

    function onOver(e: PointerEvent) {
      if (e.pointerType !== "mouse" || e.buttons) return;
      const start = e.target instanceof Element ? e.target : null;
      const el = start?.closest<HTMLElement>("[title]");
      if (held && el === held.el) return;
      if (!el || !(el instanceof HTMLElement)) {
        // Мышь ушла с элемента с подсказкой на что-то без неё.
        if (held && !held.el.contains(start)) hide();
        return;
      }
      const text = (el.getAttribute("title") || "").trim();
      const quick = shown || Date.now() - hiddenAt < SWITCH_WINDOW;
      hide();
      if (!text) return;
      const named = el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") || !!el.textContent?.trim();
      el.removeAttribute("title");
      if (!named) el.setAttribute("aria-label", text);
      held = { el, text, addedLabel: !named };
      timer = window.setTimeout(show, quick ? 0 : SHOW_DELAY);
    }

    function onOut(e: PointerEvent) {
      if (!held) return;
      const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      if (to && held.el.contains(to)) return;
      hide();
    }

    // Нажатие, прокрутка, клавиша, уход из окна — подсказка больше не к
    // месту: под курсором уже другое, а у начатого переноса плашка висела бы
    // над карточкой.
    const opts = { capture: true, passive: true } as const;
    document.addEventListener("pointerover", onOver, opts);
    document.addEventListener("pointerout", onOut, opts);
    document.addEventListener("pointerdown", conceal, opts);
    document.addEventListener("keydown", conceal, opts);
    document.addEventListener("scroll", conceal, opts);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver, opts);
      document.removeEventListener("pointerout", onOut, opts);
      document.removeEventListener("pointerdown", conceal, opts);
      document.removeEventListener("keydown", conceal, opts);
      document.removeEventListener("scroll", conceal, opts);
      window.removeEventListener("blur", hide);
      tip.remove();
    };
  }, []);

  return null;
}
