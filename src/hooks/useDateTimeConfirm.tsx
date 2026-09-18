"use client";

// Port of legacy-tracker.js's promptDateTime() — a styled date+time
// confirmation dialog used instead of the browser's native prompt() for
// meeting reschedule flows. Same Promise-based call shape: ask() resolves
// to {date, time} on OK, or null on cancel/closing without a date.
import { useCallback, useEffect, useRef, useState } from "react";
import MiniCalendar from "@/components/tracker/MiniCalendar";

// Тот же рабочий день, что и в карточке встречи: 09:00–18:00 через полчаса.
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let m = 9 * 60; m <= 18 * 60; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
})();

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
        {/* Календарь и часы — сразу, а не полями «дд.мм.гггг» и «--:--»:
            то же правило, что и в карточках задачи и встречи. Перенос
            перетаскиванием и так спрашивают на бегу, и попадание в значок
            календаря внутри поля — последнее, чего здесь хочется. */}
        <div className="field">
          <label>Дата</label>
          <MiniCalendar
            id="confirmDateTimeDate"
            value={pending.date}
            onChange={(iso) => setPending((p) => (p ? { ...p, date: iso } : p))}
          />
        </div>
        <div className="field">
          <label>Время</label>
          <div className="time-grid time-grid-compact" id="confirmDateTimeTime">
            {TIME_SLOTS.map((slot) => (
              <button
                key={slot}
                type="button"
                className={"time-slot" + (pending.time === slot ? " selected" : "")}
                onClick={() => setPending((p) => (p ? { ...p, time: slot } : p))}
              >
                {slot}
              </button>
            ))}
            {pending.time && !TIME_SLOTS.includes(pending.time) && (
              <button type="button" className="time-slot selected">
                {pending.time}
              </button>
            )}
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
