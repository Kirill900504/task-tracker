"use client";

// Port of legacy-tracker.js's promptDateTime() — a styled date+time
// confirmation dialog used instead of the browser's native prompt() for
// meeting reschedule flows. Same Promise-based call shape: ask() resolves
// to {date, time} on OK, or null on cancel/closing without a date.
import { useCallback, useEffect, useRef, useState } from "react";
import MiniCalendar from "@/components/tracker/MiniCalendar";
import { defaultMeetingStart, startsInPast } from "@/lib/meetingTime";
import { withoutSelfMark } from "@/lib/actorName";
import { dateStr } from "@/lib/taskDisplay";

// Тот же рабочий день, что и в карточке встречи: 09:00–18:00 через полчаса.
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let m = 9 * 60; m <= 18 * 60; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
})();

// Кто из людей встречи занят в это время другой встречей
// (lib/meetingTime.busyPeople). Переносы — та же дверь, через которую
// встреча получает время, что и форма, и запрет пересечений обязан стоять
// и здесь: иначе его обходят одним перетаскиванием на день календаря.
export type BusyAt = (date: string, time: string) => string[];

interface PendingAsk {
  question: string;
  date: string;
  time: string;
  busyAt?: BusyAt;
  resolve: (v: { date: string; time: string } | null) => void;
}

export function useDateTimeConfirm() {
  const [pending, setPending] = useState<PendingAsk | null>(null);
  const pendingRef = useRef<PendingAsk | null>(null);

  const ask = useCallback((question: string, defaultDate: string, defaultTime: string, busyAt?: BusyAt) => {
    return new Promise<{ date: string; time: string } | null>((resolve) => {
      const next: PendingAsk = { question, date: defaultDate || "", time: defaultTime || "", busyAt, resolve };
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

  const busyNow = pending?.busyAt && pending.date && pending.time ? pending.busyAt(pending.date, pending.time) : [];
  const dialog = pending ? (
    <div
      className="overlay open"
      id="confirmDateTimeOverlay"
      // Щелчок мимо окна ничего не отменяет — здесь выбирают дату и время
      // переноса, то есть заполняют форму, пусть и короткую (см. правило
      // про dismissOnBackdrop в Modal.tsx). Отменяют «Отменой» и Escape.
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
            popover
            id="confirmDateTimeDate"
            value={pending.date}
            // Перенос в прошлое — то же «событие в прошедшем времени», что
            // и новая встреча (07.10.2026): прошедшие дни погашены, а время,
            // уже прошедшее в выбранный день, сдвигается на ближайший слот.
            minDate={dateStr(new Date())}
            onChange={(iso) =>
              setPending((p) => (p ? { ...p, date: iso, time: startsInPast(iso, p.time) ? defaultMeetingStart(iso, TIME_SLOTS).time : p.time } : p))
            }
          />
        </div>
        <div className="field">
          <label>Время</label>
          <div className="time-grid time-grid-compact" id="confirmDateTimeTime">
            {TIME_SLOTS.map((slot) => {
              const past = startsInPast(pending.date, slot);
              const busy = !past && pending.busyAt && pending.date ? pending.busyAt(pending.date, slot) : [];
              return (
                <button
                  key={slot}
                  type="button"
                  className={"time-slot" + (pending.time === slot ? " selected" : "") + (past ? " past" : "") + (busy.length ? " busy" : "")}
                  disabled={past || busy.length > 0}
                  title={past ? "Это время уже прошло" : busy.length ? "Заняты: " + busy.map(withoutSelfMark).join(", ") : undefined}
                  onClick={() => setPending((p) => (p ? { ...p, time: slot } : p))}
                >
                  {slot}
                </button>
              );
            })}
            {pending.time && !TIME_SLOTS.includes(pending.time) && (
              <button type="button" className="time-slot selected">
                {pending.time}
              </button>
            )}
          </div>
          {busyNow.length > 0 && (
            <div className="field-hint busy-now-hint" id="confirmDateTimeBusy">
              В {pending.time} уже на другой встрече: {busyNow.map(withoutSelfMark).join(", ")}. Выберите свободное время.
            </div>
          )}
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
              disabled={!pending.date || startsInPast(pending.date, pending.time || "23:59") || busyNow.length > 0}
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
