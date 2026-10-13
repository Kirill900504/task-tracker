"use client";

// A text field that grows downwards instead of scrolling its content out of
// sight sideways. Used for every title/description in the tracker: a long
// task name used to disappear past the right edge of a single-line input,
// so you could not see what you had typed.
//
// `singleLine` keeps the value on one logical line (Enter is not a newline —
// it is passed to onEnter instead, e.g. "save this idea") while still
// wrapping and growing visually.
import { useEffect, useLayoutEffect, useRef } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

export default function AutoGrowTextarea({
  value,
  onChange,
  id,
  placeholder,
  minRows = 1,
  maxRows,
  singleLine = false,
  onEnter,
  onKeyDown,
  onBlur,
  autoFocus,
  focusAtEnd,
  className,
}: {
  value: string;
  onChange: (text: string) => void;
  id?: string;
  placeholder?: string;
  minRows?: number;
  // Потолок роста в строках. Дальше поле не растёт, а прокручивается
  // внутри: поле, выросшее выше окна, закрывает то, ради чего окно открыто
  // (13.10.2026 — поле сообщения, растянутое на весь чат).
  maxRows?: number;
  singleLine?: boolean;
  onEnter?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (e: FocusEvent<HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
  // Focus once on mount with the caret AFTER the text, not before it — for a
  // field that arrives pre-filled (a thought becoming a task or a meeting)
  // and is there to be finished, not retyped. Deferred a frame because the
  // field usually lives in a <dialog> whose showModal() runs in the parent's
  // effect, after this one, and moves focus on its own.
  focusAtEnd?: boolean;
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
    let height = el.scrollHeight + borders;
    if (maxRows) {
      const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 20;
      const pad = parseFloat(style.paddingTop || "0") + parseFloat(style.paddingBottom || "0");
      const cap = Math.ceil(line * maxRows + pad + borders);
      el.style.overflowY = height > cap ? "auto" : "hidden";
      height = Math.min(height, cap);
    }
    el.style.height = height + "px";
  }, [value, maxRows]);

  // Mount only: refocusing on a later prop change would steal the caret.
  useEffect(() => {
    if (!focusAtEnd) return;
    const frame = requestAnimationFrame(() => {
      const el = ownRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
