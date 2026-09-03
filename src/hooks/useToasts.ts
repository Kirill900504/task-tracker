"use client";

// Port of legacy-tracker.js's showToast()/toast-stack: a single mechanism
// used everywhere something destructive or status-changing happens (delete
// task/meeting/idea, idea→task/meeting conversion, meeting reschedule/
// outcome). Toasts with an undo action auto-dismiss after 6s, plain ones
// after 15s — same timings as the original.
import { useCallback, useRef, useState } from "react";

export interface Toast {
  id: string;
  title: string;
  body?: string;
  onUndo?: () => void;
}

let nextId = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const showToast = useCallback(
    (title: string, body?: string, onUndo?: () => void) => {
      const id = "toast" + nextId++;
      setToasts((prev) => [...prev, { id, title, body, onUndo }]);
      const timer = setTimeout(() => dismiss(id), onUndo ? 6000 : 15000);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  const undo = useCallback(
    (id: string) => {
      const toast = toasts.find((t) => t.id === id);
      toast?.onUndo?.();
      dismiss(id);
    },
    [toasts, dismiss],
  );

  return { toasts, showToast, dismiss, undo };
}
