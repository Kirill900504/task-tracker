"use client";

// A text field that grows downwards instead of scrolling its content out of
// sight sideways. Used for every title/description in the tracker: a long
// task name used to disappear past the right edge of a single-line input,
// so you could not see what you had typed.
//
// `singleLine` keeps the value on one logical line (Enter is not a newline —
// it is passed to onEnter instead, e.g. "save this idea") while still
// wrapping and growing visually.
import { useLayoutEffect, useRef } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

export default function AutoGrowTextarea({
  value,
  onChange,
  id,
  placeholder,
  minRows = 1,
  singleLine = false,
  onEnter,
  onKeyDown,
  onBlur,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (text: string) => void;
  id?: string;
  placeholder?: string;
  minRows?: number;
  singleLine?: boolean;
  onEnter?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: FocusEvent<HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const ownRef = useRef<HTMLTextAreaElement | null>(null);

  // Height is measured, not computed: reset to auto first so shrinking works
  // as well as growing, then take whatever the content actually needs.
  useLayoutEffect(() => {
    const el = ownRef.current;
    if (!el) return;
    el.style.height = "auto";
    // These fields are border-box, so the height we set has to cover the
    // borders too — scrollHeight counts only content plus padding, and
    // leaving the border out costs exactly enough to keep the last line
    // clipped behind a scrollbar that never appears.
    const style = getComputedStyle(el);
    const borders = parseFloat(style.borderTopWidth || "0") + parseFloat(style.borderBottomWidth || "0");
    el.style.height = el.scrollHeight + borders + "px";
  }, [value]);

  return (
    <textarea
      id={id}
      ref={ownRef}
      className={"auto-grow" + (className ? " " + className : "")}
      rows={minRows}
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      onBlur={onBlur}
      onChange={(e) => onChange(singleLine ? e.target.value.replace(/[\r\n]+/g, " ") : e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (singleLine || onEnter) && !e.shiftKey) {
          e.preventDefault();
          onEnter?.();
          return;
        }
        onKeyDown?.(e);
      }}
    />
  );
}
