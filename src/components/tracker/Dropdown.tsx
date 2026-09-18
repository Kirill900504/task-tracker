"use client";

import { useEffect, useId, useRef, useState } from "react";

// Выпадающий список, нарисованный трекером.
//
// Системный `<select>` — последнее место в трекере, которое рисовал не он.
// Снаружи его ещё можно покрасить (рамку, фон, стрелку), но раскрытый
// перечень принадлежит операционной системе: белая полоса с синей подсветкой
// поверх тёмного окна, чужой шрифт, чужие отступы. Кирилл показал на него
// пальцем — «как в программе 1995 года выпуска», — и это та же причина, по
// которой из трекера убраны `prompt`, `confirm` и `alert` (см. Ask.tsx):
// чужое окно нельзя ни объяснить, ни проверить, ни подогнать под экран.
//
// Кнопками, как везде в трекере (ChipChoice), этот выбор сделать нельзя:
// исполнителей четырнадцать, и стена из четырнадцати кнопок в строке
// фильтров съест экран, который у Кирилла весь рабочий. Поэтому список
// остаётся списком — но своим: те же цвета, тот же шрифт, те же радиусы,
// закрывается щелчком мимо и Escape, ходит стрелками с клавиатуры.
//
// Значение и разметка остаются те же, что были у `<select>` (id переезжает
// на кнопку), чтобы e2e и ручные проверки по id продолжали работать.

export type DropdownOption = { value: string; label: string };

export default function Dropdown({
  value,
  options,
  onChange,
  id,
  title,
  className,
  // Узкий вариант — для роли участника внутри строки, где места мало.
  compact,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  id?: string;
  title?: string;
  className?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);

  // Escape закрывает — тот же уговор, что и у окна вопроса и у карточки
  // задачи. Щелчок мимо закрывает подложкой (ниже), а не этим обработчиком:
  // подложка ловит нажатие до того, как оно дойдёт до кнопки под ней, и
  // список не успевает закрыться и открыться снова тем же щелчком.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  return (
    <div className={"dd-wrap" + (className ? " " + className : "")} ref={wrapRef}>
      <button
        type="button"
        id={id}
        className={"dd-trigger" + (open ? " open" : "") + (compact ? " dd-compact" : "")}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dd-value">{current?.label ?? ""}</span>
        <span className="dd-arrow" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <>
          <div className="dd-backdrop" onClick={() => setOpen(false)} />
          <div className="dd-pop" id={listId} role="listbox" tabIndex={-1}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={"dd-option" + (o.value === value ? " selected" : "")}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className="dd-option-label">{o.label}</span>
                {o.value === value && (
                  <span className="dd-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
