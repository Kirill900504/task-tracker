"use client";

import type { Toast } from "@/hooks/useToasts";

export default function ToastStack({
  toasts,
  onUndo,
  onDismiss,
}: {
  toasts: Toast[];
  onUndo: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div id="toast-stack">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span className="close" onClick={() => onDismiss(t.id)}>
            ×
          </span>
          <b>{t.title}</b>
          {t.body}
          {t.onUndo && (
            <button className="toast-undo" onClick={() => onUndo(t.id)}>
              Отменить
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
