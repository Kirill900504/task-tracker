import { flushSync } from "react-dom";

// Плавное раскрытие и сворачивание — одно на весь трекер.
//
// 21.10.2026, его слова: «большое описание плавно спокойно выплывало, без
// резких рывков… всё, что раскрывает полное описание или информацию, —
// разворачивалось плавно и аккуратно». До этого каждое раскрытие было
// скачком: длинное название задачи вываливалось на полэкрана за один кадр,
// а номер и кнопки рядом прыгали к его середине.
//
// CSS сам не умеет переходить к `height:auto`, поэтому высота считается
// здесь: замер «до», замер «после», переход между двумя числами в пикселях и
// снятие всех следов, когда он кончился, — дальше элемент снова живёт своей
// естественной высотой и растёт вместе с содержимым.
//
// Направления устроены по-разному, и это главное, что легко сломать.
// *Раскрытие* сперва меняет состояние (`flushSync` — новое содержимое уже
// в документе) и потом дорастает до него: текст встаёт на место сразу, а
// рамка открывает его сверху вниз. *Сворачивание* наоборот: сперва едет
// рамка, а состояние меняется в конце. Иначе текст схлопывается в одну
// строку мгновенно, и плавно уезжает уже пустое место — тот же рывок,
// только с задержкой.

const DURATION = 300;
const EASE = "cubic-bezier(.22,.61,.36,1)";

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function heightOf(el: HTMLElement): number {
  return el.getBoundingClientRect().height;
}

// Пока идёт переход, второе нажатие по тому же месту не начинает новый —
// иначе запоздалое «свернуть» первого перехода закрыло бы то, что второе
// только что открыло.
export function isAnimating(el: HTMLElement | null): boolean {
  return !!el?.dataset.animating;
}

export function animateHeight(
  el: HTMLElement,
  from: number,
  to: number,
  opts: { fade?: "in" | "out"; done?: () => void } = {},
) {
  if (reducedMotion() || Math.abs(from - to) < 1) {
    opts.done?.();
    return;
  }
  const s = el.style;
  el.dataset.animating = "1";
  // Замеры — по рамке (getBoundingClientRect), значит и задавать высоту
  // надо по рамке, иначе у элемента с отступами конец перехода прыгнет.
  s.boxSizing = "border-box";
  s.overflow = "hidden";
  s.height = from + "px";
  if (opts.fade === "in") s.opacity = "0";
  void el.offsetHeight; // зафиксировать «до», иначе браузер склеит оба значения в одно
  s.transition = `height ${DURATION}ms ${EASE}, opacity ${DURATION}ms ease`;
  s.height = to + "px";
  if (opts.fade === "in") s.opacity = "1";
  if (opts.fade === "out") s.opacity = "0";

  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  function onEnd(e: TransitionEvent) {
    if (e.target === el && e.propertyName === "height") finish();
  }
  function finish() {
    if (finished) return;
    finished = true;
    el.removeEventListener("transitionend", onEnd);
    clearTimeout(timer);
    // Сначала состояние (свёрнутое содержимое уже в документе), потом
    // снятие высоты — оба до следующего кадра, без вспышки полной высоты.
    opts.done?.();
    s.height = "";
    s.overflow = "";
    s.transition = "";
    s.boxSizing = "";
    s.opacity = "";
    delete el.dataset.animating;
  }
  el.addEventListener("transitionend", onEnd);
  // Вкладка в фоне или элемент убран — transitionend не придёт никогда.
  timer = setTimeout(finish, DURATION + 150);
}

// Раскрыть: состояние меняется сразу, рамка дорастает до нового содержимого.
export function grow(el: HTMLElement | null, change: () => void, fade?: boolean) {
  if (!el || reducedMotion()) {
    change();
    return;
  }
  if (isAnimating(el)) return;
  const from = heightOf(el);
  flushSync(change);
  animateHeight(el, from, heightOf(el), { fade: fade ? "in" : undefined });
}

// Свернуть: рамка уезжает к `to`, состояние меняется в конце. `to` — число
// (0 у блока, который исчезнет) или класс, с которым элемент свёрнут:
// высота меряется, на мгновение повесив его.
export function shrink(
  el: HTMLElement | null,
  to: number | { withClass?: string; withoutClass?: string },
  change: () => void,
  fade?: boolean,
) {
  if (!el || reducedMotion()) {
    change();
    return;
  }
  if (isAnimating(el)) return;
  const from = heightOf(el);
  let target: number;
  if (typeof to === "number") target = to;
  else {
    if (to.withClass) el.classList.add(to.withClass);
    if (to.withoutClass) el.classList.remove(to.withoutClass);
    target = heightOf(el);
    if (to.withClass) el.classList.remove(to.withClass);
    if (to.withoutClass) el.classList.add(to.withoutClass);
  }
  animateHeight(el, from, target, { fade: fade ? "out" : undefined, done: () => flushSync(change) });
}
