"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { animateHeight, heightOf } from "@/lib/smoothHeight";

// Блок, который появляется по нажатию, — выплывает сверху вниз, а не
// возникает целиком за один кадр (lib/smoothHeight). Обратный путь —
// `shrink(el, 0, …)` у того, кто его прячет: исчезнуть плавно блок сам не
// может, React убирает его из документа в ту же секунду.
//
// `appear={false}` — когда блок открыт с самого начала вместе со всем окном:
// окно и так появляется своим движением, второе внутри него лишнее.
export default function Reveal({
  children,
  className,
  appear = true,
}: {
  children: ReactNode;
  className?: string;
  appear?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && appear) animateHeight(el, 0, heightOf(el), { fade: "in" });
    // Только при появлении: дальше блок растёт вместе с содержимым сам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
