"use client";

import { useState } from "react";
import { getMonthGridDates } from "@/lib/calendarLogic";
import { dateStr } from "@/lib/taskDisplay";

// Календарь вместо поля даты.
//
// Поле `input[type=date]` — это «дд.мм.гггг», в которое надо либо попасть
// пальцем по крошечному значку, либо набрать восемь цифр. Календарь ту же
// дату даёт одним нажатием и, главное, показывает то, чего поле не
// показывает никогда: какой это день недели и сколько до него осталось.
// «Согласовать прайс до пятницы» — вопрос о календаре, а не о числе.
//
// Сетка строится той же функцией, что и большой календарь трекера
// (getMonthGridDates): шесть недель с понедельника, с хвостами соседних
// месяцев — чтобы две сетки на одном экране не разъезжались.

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function parseIso(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export default function MiniCalendar({
  value,
  onChange,
  id,
  // Кнопка «без срока»: у задачи дата необязательна, у встречи — нет.
  clearable,
  // Раскрываться по нажатию, а не стоять развёрнутым.
  //
  // Так теперь везде, где спрашивают дату: развёрнутая сетка месяца — это
  // треть карточки ради поля, в которое смотрят секунду. Строка с самой
  // датой отвечает на вопрос «когда» так же, а место занимает в одну
  // строку.
  popover,
}: {
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  clearable?: boolean;
  popover?: boolean;
}) {
  // Показанный месяц ведётся отдельно от выбранной даты: листать вперёд,
  // ничего не выбирая, — обычное дело.
  const [view, setView] = useState(() => parseIso(value) || new Date());
  const days = getMonthGridDates(view);
  const today = dateStr(new Date());
  const month = view.getMonth();

  // Раскрыт ли календарь. В обычном режиме — всегда.
  const [open, setOpen] = useState(false);

  function shiftMonth(by: number) {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + by, 1));
  }

  const grid = (
    <div className="mini-cal" id={popover ? undefined : id} data-value={popover ? undefined : value}>
      <div className="mini-cal-head">
        <button type="button" className="mini-cal-nav" onClick={() => shiftMonth(-1)} title="Предыдущий месяц">
          ←
        </button>
        <span className="mini-cal-month">
          {MONTHS[month]} {view.getFullYear()}
        </span>
        <button type="button" className="mini-cal-nav" onClick={() => shiftMonth(1)} title="Следующий месяц">
          →
        </button>
        {clearable && value && (
          <button type="button" className="mini-cal-clear" onClick={() => onChange("")} title="Без срока">
            ✕
          </button>
        )}
      </div>
      <div className="mini-cal-grid">
        {WEEKDAYS.map((w) => (
          <span className="mini-cal-wd" key={w}>
            {w}
          </span>
        ))}
        {days.map((d) => {
          const iso = dateStr(d);
          return (
            <button
              key={iso}
              type="button"
              data-date={iso}
              className={
                "mini-cal-day" +
                (d.getMonth() === month ? "" : " other") +
                (iso === today ? " today" : "") +
                (iso === value ? " selected" : "")
              }
              onClick={() => {
                onChange(iso);
                // Выбрали дату — всплывающий календарь закрылся: его ради
                // неё и открывали. Закрывать его перехватом клика нельзя:
                // разметка исчезает раньше, чем нажатие доходит до самой
                // кнопки, и дата не выбирается вовсе.
                setOpen(false);
              }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (!popover) return grid;

  return (
    <div className="mini-cal-wrap" id={id} data-value={value}>
      <button
        type="button"
        className={"mini-cal-trigger" + (open ? " open" : "")}
        onClick={() => setOpen((v) => !v)}
        title="Выбрать дату"
      >
        📅 {value ? value.split("-").reverse().join(".") : "Выбрать дату"}
      </button>
      {open && (
        <>
          {/* Клик мимо закрывает — тот же приём, что и у меню карточки
              (.export-backdrop): без него календарь остаётся раскрытым и
              закрывать его приходится той же кнопкой, которой открыли. */}
          <div className="mini-cal-backdrop" onClick={() => setOpen(false)} />
          <div className="mini-cal-pop">{grid}</div>
        </>
      )}
    </div>
  );
}
