"use client";

import { useSyncExternalStore } from "react";

// One definition of "this is a phone", shared by everything that has to
// behave differently there. 768px matches the breakpoint the stylesheet and
// QuickAdd already use.
export const MOBILE_QUERY = "(max-width: 768px)";

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
