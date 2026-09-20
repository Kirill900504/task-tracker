"use client";

import { useEffect, useState } from "react";
import { getMonthGridDates } from "@/lib/calendarLogic";
import { dateStr } from "@/lib/taskDisplay";
import Icon from "./Icon";

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

  // Escape закрывает шторку, а не окно под ней.
  //
  // Общий useEscapeToClose здесь не годится, и причина техническая:
  // календарь всплывает внутри настоящего <dialog>, а Escape в нём — это
  // «запрос на закрытие», который браузер выполняет САМ, независимо от
  // того, остановил кто-нибудь событие или нет. Остановить его можно
  // только отменой действия по умолчанию — preventDefault на keydown, —
  // чего общий хук не делает и делать не должен: он написан для окон,
  // которым закрыться как раз надо. Без этого один Escape закрывал бы
  // разом и календарь, и форму задачи вместе с набранным в ней.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

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
        <Icon name="calendar" size={15} /> {value ? value.split("-").reverse().join(".") : "Выбрать дату"}
      </button>
      {/* Календарь — шторка поверх формы, а не вставка в неё.
          Слова Кирилла 20.09.2026: «чтобы календарь не расширял окна
          создания встречи или задачи, а плавно всплывал поверх окна
          создающегося события, мягко, как шторка».

          До этого он раздвигал форму, и так было сделано намеренно: когда
          сетка месяца просто ложилась на соседний ряд, половина кнопок
          «Сегодня / Завтра / Через неделю» скрывалась, половина торчала
          сбоку — «кнопки залазят друг на друга». Но раздвигание лечило
          симптом: форма подпрыгивала на треть экрана, и кнопки, ради
          которых всё затевалось, уезжали вниз вместе с ней.

          Ошибкой был не сам всплывающий календарь, а полумера: он
          накрывал часть формы, оставаясь с ней на одном плане. Теперь он
          накрывает её ЦЕЛИКОМ — затемнение на всю площадь окна и карточка
          календаря по центру. Спорить с кнопками больше нечем: их видно,
          что они за шторкой, а не «под сеткой». Закрывается щелчком мимо,
          выбором дня и Escape, и всё это возвращает форму нетронутой.

          Закрытие ловится на mousedown, а щелчок внутри карточки на нём же
          и останавливается: на click подложка исчезала бы раньше, чем
          нажатие доходит до самой кнопки дня, и дата не выбиралась бы
          вовсе — этим прежняя подложка и была плоха. */}
      {open && (
        <div className="cal-sheet-scrim" onMouseDown={() => setOpen(false)}>
          <div className="cal-sheet" role="dialog" aria-label="Выбор даты" onMouseDown={(event) => event.stopPropagation()}>
            {grid}
          </div>
        </div>
      )}
    </div>
  );
}
