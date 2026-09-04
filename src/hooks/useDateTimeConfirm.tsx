"use client";

// Port of legacy-tracker.js's promptDateTime() — a styled date+time
// confirmation dialog used instead of the browser's native prompt() for
// meeting reschedule flows. Same Promise-based call shape: ask() resolves
// to {date, time} on OK, or null on cancel/closing without a date.
import { useCallback, useEffect, useRef, useState } from "react";

interface PendingAsk {
  question: string;
  date: string;
  time: string;
  resolve: (v: { date: string; time: string } | null) => void;
}

export function useDateTimeConfirm() {
  const [pending, setPending] = useState<PendingAsk | null>(null);
  const pendingRef = useRef<PendingAsk | null>(null);

  const ask = useCallback((question: string, defaultDate: string, defaultTime: string) => {
    return new Promise<{ date: string; time: string } | null>((resolve) => {
      const next: PendingAsk = { question, date: defaultDate || "", time: defaultTime || "", resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  function finish(result: { date: string; time: string } | null) {
    pendingRef.current?.resolve(result);
    pendingRef.current = null;
    setPending(null);
  }

  // Esc cancels, same as legacy's global keydown handler (which kept an
  // activeDateTimeCancel reference specifically so this dialog answered to it).
  const open = pending !== null;
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      pendingRef.current?.resolve(null);
      pendingRef.current = null;
      setPending(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const dialog = pending ? (
    <div
      className="overlay open"
      id="confirmDateTimeOverlay"
      onClick={(e) => e.target === e.currentTarget && finish(null)}
    >
      <div className="modal" style={{ maxWidth: 360 }}>
        <h2>Подтвердите действие</h2>
        <p className="confirm-dt-question" id="confirmDateTimeQuestion">
          {pending.question}
        </p>
        <div className="row2">
          <div className="field">
            <label>Дата</label>
            <input
              type="date"
              id="confirmDateTimeDate"
              value={pending.date}
              onChange={(e) => setPending((p) => (p ? { ...p, date: e.target.value } : p))}
            />
          </div>
          <div className="field">
            <label>Время</label>
            <input
              type="time"
              id="confirmDateTimeTime"
              value={pending.time}
              onChange={(e) => setPending((p) => (p ? { ...p, time: e.target.value } : p))}
            />
          </div>
        </div>
        <div className="modal-actions">
          <div className="left"></div>
          <div className="left">
            <button className="btn" id="confirmDateTimeCancelBtn" onClick={() => finish(null)}>
              Отмена
            </button>
            <button
              className="btn btn-primary"
              id="confirmDateTimeOkBtn"
              onClick={() => finish(pending.date ? { date: pending.date, time: pending.time } : null)}
            >
              ОК
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, dialog };
}
