"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Длинный текст — свёрнут до пяти строк, с явной кнопкой «Показать
// полностью», как попросил Кирилл 23.09.2026 («окно описание задачи
// хотелось бы чтобы разворачивалось по запросу полностью», пример —
// пост в Битриксе с ▽/▲ снизу). Короткий текст, который и так помещается
// в эти пять строк, кнопки не получает вовсе: сворачивать то, что не
// свёрнуто, — вопрос без причины.
//
// Свернуть/развернуть эту же кнопкой можно и обратно — не только раскрыть.
export default function ExpandableText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Мерится после отрисовки: свёрнутая высота (line-clamp) сравнивается с
  // тем, сколько текст занял бы без него. Совпали — кнопка не нужна.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <>
      <div ref={ref} className={className + (!expanded ? " clamped" : "")}>
        {text}
      </div>
      {(overflowing || expanded) && (
        <button type="button" className="expand-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "▲ Свернуть" : "▽ Показать полностью"}
        </button>
      )}
    </>
  );
}
