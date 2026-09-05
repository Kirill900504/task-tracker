"use client";

// Native date/time inputs only open their picker when you hit the small
// calendar/clock glyph, which is a fiddly target. Wiring this onto onClick
// makes the whole field open it, which is what everyone expects.
//
// showPicker() is Chromium/Safari; where it is missing (or the browser
// refuses it outside a user gesture) the field still behaves like a normal
// input, glyph included — hence the swallowed error rather than a fallback.
import type { MouseEvent } from "react";

export function openPickerOnClick(e: MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
  try {
    el.showPicker?.();
  } catch {
    /* not allowed here — the built-in glyph still works */
  }
}
