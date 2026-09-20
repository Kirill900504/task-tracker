"use client";

import { useEffect } from "react";
import { hasMessengerLaunch } from "@/lib/messengerLaunch";

// Окно мини-приложения: во весь экран, своего цвета и не закрывается от
// прокрутки.
//
// Мессенджер открывает мини-приложение половинной высоты и ждёт, что
// приложение о себе заявит. Дальше — то, что на телефоне решает всё:
// вертикальный свайп внутри окна Telegram по умолчанию ЗАКРЫВАЕТ его, а
// не прокручивает содержимое. То есть человек листает список задач, окно
// уезжает вниз, и трекер «сам закрылся» — в мини-приложении это самая
// частая жалоба вообще, и списать её не на что: выглядит как поломка
// трекера, хотя это поведение мессенджера.
//
// Почему это не лежит в /app, где уже есть ready() и expand(). Потому что
// /app живёт полсекунды и тут же уходит на «/» (см. там же), а настройки
// окна нужны там, где человек работает. Признак запуска запоминается в
// sessionStorage: данные мессенджера приходят один раз, во фрагменте
// адреса первой страницы, а вкладка потом живёт своей жизнью.
//
// Скрипт мессенджера подключается ТОЛЬКО здесь и только когда мы
// действительно внутри мини-приложения. Вход от него по-прежнему не
// зависит вовсе (подпись берётся из фрагмента адреса — см. /app): если
// скрипт не загрузится, не будет ровно этих удобств, а трекер откроется
// как открывался.

const FLAG = "rokas:miniapp";
const SCRIPT_ID = "tg-webapp-script";

type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  isVerticalSwipesEnabled?: boolean;
};

// Тот же цвет, что у шапки трекера (--paper в globals) и у themeColor в
// layout: окно мессенджера не должно начинаться чужой полосой над нашей.
const CHROME = "#232B2E";

function tune(app: TelegramWebApp | undefined) {
  if (!app) return;
  app.ready?.();
  app.expand?.();
  // Bot API 7.7. Старые клиенты метода не знают — тогда остаётся как было.
  app.disableVerticalSwipes?.();
  app.setHeaderColor?.(CHROME);
  app.setBackgroundColor?.(CHROME);
}

export default function MiniAppChrome() {
  useEffect(() => {
    const win = window as unknown as { Telegram?: { WebApp?: TelegramWebApp }; WebApp?: TelegramWebApp };

    // Пришли из мессенджера прямо сейчас — или приходили в этой вкладке
    // раньше. Второе и есть причина флага: на «/» фрагмента уже нет.
    let launched = false;
    try {
      launched = sessionStorage.getItem(FLAG) === "1";
    } catch {
      // Приватное окно или запрет на хранилище: тогда работаем только по
      // фрагменту, то есть на первой странице.
    }
    // Тем же правилом, каким это распознаёт страница входа: второй
    // разбор фрагмента разошёлся бы с первым в первый же день.
    const fromHash = hasMessengerLaunch(window.location.hash || "");
    if (fromHash && !launched) {
      launched = true;
      try {
        sessionStorage.setItem(FLAG, "1");
      } catch {
        /* см. выше */
      }
    }
    if (!launched) return;

    // Объект уже есть (скрипт подключён мессенджером или нами раньше).
    if (win.Telegram?.WebApp || win.WebApp) {
      tune(win.Telegram?.WebApp ?? win.WebApp);
      return;
    }
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.onload = () => tune((window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp);
    // Молча: не загрузился — значит просто нет этих удобств.
    script.onerror = () => {};
    document.head.appendChild(script);
  }, []);

  return null;
}
