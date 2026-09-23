"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Icon from "./Icon";

// Длинный текст — свёрнут до пяти строк, с явной кнопкой «Показать
// полностью», как попросил Кирилл 23.09.2026 («окно описание задачи
// хотелось бы чтобы разворачивалось по запросу полностью», пример —
// пост в Битриксе с ▽/▲ снизу).
//
// Первая версия — голая ссылка с треугольником — не прошла: «смотрится
// скупо/бедно/жадно/не современно». Треугольник ▽ и был лишним —
// единственное место, где текст рисовал не свой значок, а символ чужого
// шрифта (то же правило, что у эмодзи в CLAUDE.md). Теперь свёрнутый текст
// плавно гаснет градиентом у нижнего края (подсказывает, что дальше есть
// ещё, без необходимости читать подпись), а под ним — настоящая кнопка со
// значком из общего набора, который разворачивается стрелкой при открытии.
//
// Короткий текст, который и так помещается в пять строк, кнопки не
// получает вовсе: сворачивать то, что не свёрнуто, — вопрос без причины.
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

  const showToggle = overflowing || expanded;

  return (
    <div className={"expandable" + (showToggle && !expanded ? " has-fade" : "")}>
      <div ref={ref} className={className + (!expanded ? " clamped" : "")}>
        {text}
      </div>
      {showToggle && (
        <button type="button" className="expand-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Свернуть" : "Показать полностью"}
          <Icon name={expanded ? "arrow-up" : "arrow-down"} size={13} />
        </button>
      )}
    </div>
  );
}
