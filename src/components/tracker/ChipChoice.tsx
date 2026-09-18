"use client";

import type { ReactNode } from "react";

// Выбор из нескольких — кнопками, а не выпадающим списком.
//
// Кирилл сказал прямо: «все поля сделать не вываливающимся списком, кнопками
// для выбора — так значительно быстрее». Считать нечего: выпадающий список
// это нажать, дождаться, прочитать весь перечень, найти нужное, нажать ещё
// раз — пять действий и обязательное чтение там, где вариантов два. Кнопки
// показывают и выбор, и выбранное одновременно, а на телефоне не открывают
// системную «шторку» поверх формы.
//
// Списки, которые от этого стали бы стеной кнопок (31 число месяца), так и
// остались полями ввода — правило про кнопки касается выбора из нескольких,
// а не любого ввода вообще.

export type Chip<T extends string> = { value: T; label: string; title?: string };

export default function ChipChoice<T extends string>({
  id,
  value,
  options,
  onSelect,
  extra,
  compact,
}: {
  id?: string;
  value: T;
  options: Chip<T>[];
  onSelect: (value: T) => void;
  // Кнопки, которые не выбирают, а делают: «+ раздел», «удалить раздел».
  extra?: ReactNode;
  // Для длинных рядов вроде дней недели и месяцев.
  compact?: boolean;
}) {
  return (
    <div className={"participant-grid" + (compact ? " chips-compact" : "")} id={id} data-value={value}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={"participant-chip" + (value === o.value ? " selected" : "")}
          data-value={o.value}
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onSelect(o.value)}
        >
          {o.label}
        </button>
      ))}
      {extra}
    </div>
  );
}
