"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Цитата в шапке — всегда одна строка, на любом мониторе.
//
// Раньше её размер задавался в `vw` и подбирался «на глаз»: на широком
// экране строка стояла одна, а на ноутбуке 1366 приходила в тот же средний
// столбец шапки, места в котором вдвое меньше, и разваливалась на две-три
// строки. Догадаться о ширине этого столбца из `vw` нельзя в принципе:
// слева бренд, справа кнопки, которых бывает от пяти до девяти, и они ещё
// и переносятся. Единственный, кто знает ширину, — браузер, поэтому она
// измеряется, а не вычисляется.
//
// Приём точный, а не итеративный: ширина текста растёт ровно
// пропорционально кеглю, поэтому нужный кегль получается за один шаг —
// текущий, умноженный на отношение «сколько есть» к «сколько нужно».
// Повторный замер после этого даёт то же число и цикл останавливается.

const QUOTE_HEAD = "Есть десятилетия, за которые ничего не случается, ";
const QUOTE_TAIL = "и есть недели, за которые случаются десятилетия.";

// Границы кегля. Верхняя — прежний размер строки: цитата не должна
// перерастать заголовок рядом с ней. Нижняя — та, ниже которой читать уже
// нечего; вместо нечитаемой строки цитата убирается совсем.
const MAX_SIZE = 19;
const MIN_SIZE = 10;

export default function HeaderQuote() {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<HTMLSpanElement | null>(null);
  const [size, setSize] = useState(MAX_SIZE);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const line = lineRef.current;
    if (!box || !line) return;

    function measure() {
      if (!box || !line) return;
      // clientWidth столбца, а не строки: строка набрана в nowrap и её
      // собственная ширина — это «сколько нужно», а не «сколько есть».
      const available = box.clientWidth;
      const natural = line.scrollWidth;
      if (!available || !natural) return;

      // Один пиксель запаса: scrollWidth округляется вверх, и без него
      // строка, влезающая ровно, иногда всё же обрезается.
      const wanted = (size * (available - 1)) / natural;
      setFits(wanted >= MIN_SIZE);
      const next = Math.min(MAX_SIZE, Math.max(MIN_SIZE, wanted));
      // Порог против дребезга: без него округление кегля до субпикселя
      // заставляет замер и отрисовку гоняться друг за другом.
      if (Math.abs(next - size) > 0.3) setSize(next);
    }

    measure();

    // Ширина столбца меняется не только вместе с окном: кнопки в шапке
    // появляются и исчезают (приглашение, установка приложения), и ряд
    // переносится, ничего не спрашивая у window.
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [size]);

  return (
    <div className="header-quote" ref={boxRef} aria-hidden={!fits}>
      <span
        className="hqline"
        ref={lineRef}
        // visibility, а не display:none: скрытую строку нечем измерить, и
        // цитата, однажды не поместившаяся, никогда бы не вернулась.
        style={{ fontSize: size + "px", visibility: fits ? undefined : "hidden" }}
      >
        {QUOTE_HEAD}
        <b>{QUOTE_TAIL}</b>
      </span>
    </div>
  );
}
