"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// Одно окно на все окна трекера — и оно настоящее, браузерное.
//
// Раньше каждое окно было парой <div>: затемнённый фон и коробка поверх. К
// такой паре приходится приделывать руками всё, что делает окно окном, и
// каждый пункт этого списка когда-нибудь забывают: Esc, клик по фону,
// фокус, который не должен уходить за окно, возврат фокуса на кнопку после
// закрытия, недоступность того, что под окном, для клавиатуры и чтения с
// экрана.
//
// `<dialog>` с `showModal()` делает всё это сам и правильнее: браузер
// кладёт окно в верхний слой (его нельзя перекрыть или обрезать чужим
// z-index'ом и overflow'ом), запирает в нём фокус, помечает остальную
// страницу как неактивную и отдаёт ::backdrop для затемнения.
//
// Что осталось нашим: закрытие по Esc должно доходить до React, а не просто
// схлопывать окно — иначе состояние снаружи так и будет считать его
// открытым (`onCancel`), и клик мимо окна закрывает его так же, как раньше.

export default function Modal({
  onClose,
  children,
  id,
  className,
  // Окно вопроса живёт поверх остальных и открывается, когда какое-то из
  // них уже открыто. Браузер складывает их в верхнем слое в порядке
  // открытия, но собственный класс нужен, чтобы отличать их в стилях.
  variant,
}: {
  onClose: () => void;
  children: ReactNode;
  id?: string;
  className?: string;
  variant?: string;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // showModal, а не open=true: только он даёт верхний слой, ловушку
    // фокуса и ::backdrop. Второй вызов на уже открытом окне — исключение,
    // поэтому проверка.
    if (!el.open) el.showModal();
    return () => {
      if (el.open) el.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      id={id}
      className={"overlay open" + (variant ? " " + variant : "") + (className ? " " + className : "")}
      // Esc закрывает окно силами браузера — но состояние снаружи об этом
      // не узнает, поэтому событие перехватывается и решение принимает
      // React. Иначе окно исчезает с экрана и остаётся «открытым» в коде.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
