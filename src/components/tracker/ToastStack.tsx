"use client";

import type { Toast } from "@/hooks/useToasts";
import Icon from "./Icon";

// Нижний правый угол, карточкой — «как вылетают в мессенджерах МАХ и
// телеграм» (23.09.2026). Раньше это была сплошная цветная плашка в левом
// верхнем углу: и место, и вид достались от системного всплытия браузера, а
// не от мессенджера, на который просили равняться. Кружок со значком слева
// — тот же приём, что у аватара во входящем сообщении: по нему уведомление
// узнают раньше, чем читают.
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
          <div className="toast-icon">
            <Icon name="bell" size={16} />
          </div>
          <div className="toast-text">
            <b>{t.title}</b>
            {t.body && <span className="toast-body">{t.body}</span>}
            {t.onUndo && (
              <button className="toast-undo" onClick={() => onUndo(t.id)}>
                Отменить
              </button>
            )}
          </div>
          {/* A button, and placed over the text rather than floated into it —
              see .toast .close in tracker.css for what floating cost. */}
          <button className="close" aria-label="Закрыть" onClick={() => onDismiss(t.id)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
