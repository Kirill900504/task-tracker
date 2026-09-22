"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// Свайп по карточке: вправо — закрыть, влево — действия.
//
// Вправо — то единственное, что стоит жеста: это делают двадцать раз в
// день. Влево — меню, то же самое, что открывает «⋮» у края карточки, и
// добавлено оно 22.09.2026 по просьбе Кирилла: на телефоне путь «нашёл
// задачу → попал в точку размером с горошину → выбрал» самый длинный в
// трекере, а свободным оставался ровно один жест.
//
// Удаления среди них нет и не будет: свайпом вещи исчезают из кармана
// так, что никто этого не хотел. Удаление остаётся за карточкой и
// вопросом.
//
// Только палец: мышью тот же жест переносит карточку между столбцами, и
// перехватывать его значит сломать компьютер.

const TRIGGER_PX = 90;
// Ниже этого движение считается началом прокрутки, а не жестом.
const DIRECTION_LOCK_PX = 10;

export function useSwipeComplete({
  onComplete,
  onActions,
  enabled,
}: {
  // Вправо. Нет — значит вправо тянуть некуда: закрывать задачу вправе
  // постановщик, и у исполнителя этого жеста не должно быть вовсе.
  onComplete?: () => void;
  // Влево. Нет — значит у карточки нет меню, и тянуть влево тоже некуда.
  onActions?: () => void;
  enabled: boolean;
}) {
  const [offset, setOffset] = useState(0);
  // Расстояние живёт ещё и в ref: обработчик отпускания выполняется в том
  // же замыкании, что и движения до него, и состояние прочиталось бы
  // таким, каким было ДО жеста, то есть нулём.
  const offsetRef = useRef(0);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const decidedRef = useRef<"none" | "swipe" | "scroll">("none");
  // Держатся свежими, не перевешивая слушателей на каждую перерисовку.
  const completeRef = useRef(onComplete);
  const actionsRef = useRef(onActions);
  useEffect(() => {
    completeRef.current = onComplete;
    actionsRef.current = onActions;
  }, [onComplete, onActions]);

  // Отпускание ловится на окне, а не на карточке. К этому моменту карточка
  // уехала из-под пальца, и pointerup может прийти куда угодно: привязанный
  // к самой карточке, жест просто никогда не заканчивался — ровно это он и
  // делал.
  const finish = useCallback(() => {
    const gone = offsetRef.current;
    const swiped = decidedRef.current === "swipe";
    startRef.current = null;
    decidedRef.current = "none";
    offsetRef.current = 0;
    setOffset(0);
    if (!swiped) return;
    if (gone >= TRIGGER_PX) completeRef.current?.();
    else if (gone <= -TRIGGER_PX) actionsRef.current?.();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    function onRelease() {
      if (startRef.current) finish();
    }
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onRelease);
    return () => {
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", onRelease);
    };
  }, [enabled, finish]);

  function onPointerDown(e: ReactPointerEvent) {
    if (!enabled || e.pointerType !== "touch") return;
    startRef.current = { x: e.clientX, y: e.clientY };
    decidedRef.current = "none";
  }

  function onPointerMove(e: ReactPointerEvent) {
    const start = startRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    if (decidedRef.current === "none") {
      if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
      // Какая ось ушла дальше — тем жест и становится, один раз.
      decidedRef.current = Math.abs(dx) > Math.abs(dy) ? "swipe" : "scroll";
    }
    if (decidedRef.current !== "swipe") return;
    // Начавшийся жест — наш: без этого страница уезжает вбок вместе с
    // карточкой, а на телефоне это ещё и «назад» в истории браузера.
    if (e.cancelable) e.preventDefault();

    // Каждая сторона открыта настолько, насколько ей есть что предложить:
    // без меню влево тянуть некуда, без права закрыть — вправо. Потолок
    // не даёт карточке уехать с экрана.
    const max = TRIGGER_PX + 30;
    const next = Math.max(actionsRef.current ? -max : 0, Math.min(dx, completeRef.current ? max : 0));
    offsetRef.current = next;
    setOffset(next);
  }

  return {
    // Раскладывается на карточку.
    handlers: enabled ? { onPointerDown, onPointerMove } : {},
    // Применяется трансформацией, а из-под карточки проступает подсказка.
    offset,
    // Доведён ли жест до срабатывания — и в какую сторону.
    armed: offset >= TRIGGER_PX,
    armedLeft: offset <= -TRIGGER_PX,
  };
}
