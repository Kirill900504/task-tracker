"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// Swipe a card to the right to finish it — the one action worth a gesture,
// because it is the one you do twenty times a day.
//
// Deliberately only this one. A swipe that deletes is how things disappear
// from a pocket without anyone meaning it; deleting stays behind a card and
// a confirmation.
//
// Touch only: with a mouse the same drag is how a card is moved between
// columns, and hijacking that would break the desktop.

const TRIGGER_PX = 90;
// Below this the movement is treated as the start of a scroll, not a swipe.
const DIRECTION_LOCK_PX = 10;

export function useSwipeComplete(onComplete: () => void, enabled: boolean) {
  const [offset, setOffset] = useState(0);
  // The distance also lives in a ref: the release handler runs in the same
  // closure as the moves that preceded it, so reading it from state would
  // read whatever it was before the gesture — zero, always.
  const offsetRef = useRef(0);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const decidedRef = useRef<"none" | "swipe" | "scroll">("none");
  // Kept current without re-binding listeners on every render.
  const completeRef = useRef(onComplete);
  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  // The release is caught on the window, not on the card. By the time the
  // finger lifts, the card has moved out from under it and the pointerup can
  // land anywhere — bound to the card alone, the gesture would simply never
  // finish, which is exactly what it did.
  const finish = useCallback(() => {
    const swiped = decidedRef.current === "swipe" && offsetRef.current >= TRIGGER_PX;
    startRef.current = null;
    decidedRef.current = "none";
    offsetRef.current = 0;
    setOffset(0);
    if (swiped) completeRef.current();
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
      // Whichever axis moved further decides what this gesture is, once.
      decidedRef.current = Math.abs(dx) > Math.abs(dy) ? "swipe" : "scroll";
    }
    if (decidedRef.current !== "swipe") return;

    // Rightwards only, and with a ceiling so the card never leaves the screen.
    const next = Math.max(0, Math.min(dx, TRIGGER_PX + 30));
    offsetRef.current = next;
    setOffset(next);
  }

  return {
    // Spread onto the card.
    handlers: enabled ? { onPointerDown, onPointerMove } : {},
    // Applied as a transform, plus a hint that shows through underneath.
    offset,
    armed: offset >= TRIGGER_PX,
  };
}
