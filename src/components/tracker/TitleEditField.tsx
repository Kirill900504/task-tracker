"use client";

import { useRef, useState } from "react";
import AutoGrowTextarea from "./AutoGrowTextarea";

// Поле правки названия на месте самого названия — у кубика задачи, у
// карточки встречи и в шапке их окон (28.10.2026, его слова: «удобно
// редактировать название задачи, в канбане нажав на поле… сделай аналогично
// и во встречах»). Одно на все места: три копии этих двадцати строк
// разошлись бы на первой же правке, как в этом проекте расходилось всё.
//
// Enter или щелчок мимо сохраняют, Escape отменяет — и только правку:
// внутри <dialog> Escape иначе закрыл бы всё окно (preventDefault снимает
// его «запрос на закрытие», см. useEscapeToClose). Пустое и неизменённое
// название не сохраняется.
//
// Поле часто лежит внутри перетаскиваемой карточки, поэтому всё, что в нём
// происходит, дальше поля не идёт: щелчок открыл бы карточку, а пробел и
// Enter dnd-kit читает как «взять карточку клавиатурой» — набранное слово
// уносило бы её в соседний столбец.
export default function TitleEditField({
  value,
  onDone,
  className,
  id,
}: {
  value: string;
  // Новое название, или null — правку отменили или ничего не поменяли.
  onDone: (next: string | null) => void;
  className?: string;
  id?: string;
}) {
  const [draft, setDraft] = useState(value);
  // Enter сохраняет и тут же снимает поле, а снятие поля шлёт blur — без
  // флага одно нажатие сохраняло бы дважды.
  const doneRef = useRef(false);
  function finish(save: boolean) {
    if (doneRef.current) return;
    doneRef.current = true;
    const next = draft.trim();
    onDone(save && next && next !== value ? next : null);
  }
  return (
    <span
      className="title-edit"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <AutoGrowTextarea
        id={id}
        className={className}
        singleLine
        focusAtEnd
        value={draft}
        onChange={setDraft}
        onEnter={() => finish(true)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          finish(false);
        }}
      />
    </span>
  );
}
