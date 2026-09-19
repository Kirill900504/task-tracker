"use client";

import { useEffect } from "react";
import { reportCrash } from "@/lib/reportCrash";

// Ошибки, которые не долетают до React.
//
// `global-error.tsx` ловит падение отрисовки — а это лишь часть поломок.
// Остальные случаются в обработчиках, в ответах сети, в промисах, которые
// никто не поймал: экран при этом остаётся на месте, но кнопка перестаёт
// работать, задача не сохраняется, список не обновляется. Для человека это
// «трекер глючит», а для нас — тишина, потому что до сегодняшнего дня о
// таком не узнавал никто вообще.
//
// Слушатели ставятся один раз на всё приложение, здесь же, в корне.

export default function CrashWatch() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportCrash(event.error ?? event.message, { where: "ошибка на странице" });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportCrash(event.reason, { where: "необработанный сбой" });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
