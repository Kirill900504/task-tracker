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

// Значение флага — какой мессенджер, а не просто «да»: у каждого свой мост,
// и до 13.10.2026 внутри MAX грузился телеграмовский. Он MAX не знает, и
// окно MAX так ни разу и не услышало `ready()` — а держит оно свою белую
// заглушку именно до этого сигнала или до полной загрузки страницы.
// «1» — значение из прежней версии: оно означало Telegram.
const FLAG = "rokas:miniapp";
const SCRIPT_ID = "messenger-webapp-script";
// Telegram's bridge is served from our own origin first. telegram.org is
// blocked or throttled on a large share of Russian networks (14.10.2026: two
// of three Moscow/St Petersburg probes timed out on it), and the mini-app's
// WebView fetches it over the phone's own connection, not through Telegram's.
// Our origin is, by definition, reachable whenever the page itself loaded.
// The copy is Telegram's own file, unmodified; refresh it from
// https://telegram.org/js/telegram-web-app.js when a newer Bot API method is
// needed. The original address stays as the fallback. MAX's st.max.ru answered
// from every Russian probe, so it is loaded where MAX publishes it.
const BRIDGE: Record<"telegram" | "max", string[]> = {
  telegram: ["/vendor/telegram-web-app.js", "https://telegram.org/js/telegram-web-app.js"],
  max: ["https://st.max.ru/js/max-web-app.js"],
};

function launchChannel(hash: string): "telegram" | "max" | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.get("tgWebAppData")) return "telegram";
  if (params.get("WebAppData")) return "max";
  return null;
}

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

// Подпись мессенджера, которую /app не стал проверять до перехода, потому
// что сессия на устройстве уже была (см. там же). Ключ — тот же текст, что
// в src/app/app/page.tsx.
const PENDING = "rokas:miniapp-pending";

// Проверить её фоном тем же маршрутом, которым /app входит сам. Ответа три:
// тот же человек — ничего не делать (обычный случай, экран уже верный);
// другой человек — маршрут уже поставил его куки, и трекер открывается
// заново под ним; отказ — тоже ничего: сессия на устройстве принадлежит
// тому, кто её завёл, и прослойка на «/» проверяет её сама, как при
// обычном входе с паролем.
async function verifyPending() {
  let launch: { channel?: string; initData?: string } | null = null;
  try {
    launch = JSON.parse(sessionStorage.getItem(PENDING) || "null");
    sessionStorage.removeItem(PENDING);
  } catch {
    return;
  }
  if (!launch?.initData || (launch.channel !== "telegram" && launch.channel !== "max")) return;
  try {
    const res = await fetch(`/api/${launch.channel}/miniapp-auth`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: launch.initData }),
    });
    const body = (await res.json().catch(() => null)) as { switched?: boolean; tokenHash?: string } | null;
    if (body?.switched) {
      window.location.replace("/");
    } else if (body?.tokenHash) {
      // Сервер не смог поставить сессию сам — так же, как на /app.
      const { createClient } = await import("@/lib/supabase/client");
      const { error } = await createClient().auth.verifyOtp({ type: "magiclink", token_hash: body.tokenHash });
      if (!error) window.location.replace("/");
    }
  } catch {
    /* нет связи — экран остаётся тем, что уже открыт */
  }
}

export default function MiniAppChrome() {
  useEffect(() => {
    void verifyPending();
  }, []);

  useEffect(() => {
    const win = window as unknown as { Telegram?: { WebApp?: TelegramWebApp }; WebApp?: TelegramWebApp };

    // Пришли из мессенджера прямо сейчас — или приходили в этой вкладке
    // раньше. Второе и есть причина флага: на «/» фрагмента уже нет.
    let channel: "telegram" | "max" | null = null;
    try {
      const stored = sessionStorage.getItem(FLAG);
      channel = stored === "max" ? "max" : stored ? "telegram" : null;
    } catch {
      // Приватное окно или запрет на хранилище: тогда работаем только по
      // фрагменту, то есть на первой странице.
    }
    // Тем же правилом, каким это распознаёт страница входа: второй
    // разбор фрагмента разошёлся бы с первым в первый же день.
    const hash = window.location.hash || "";
    if (hasMessengerLaunch(hash)) {
      channel = launchChannel(hash) ?? channel;
      try {
        if (channel) sessionStorage.setItem(FLAG, channel);
      } catch {
        /* см. выше */
      }
    }
    if (!channel) return;

    const current = () => {
      const w = window as unknown as { Telegram?: { WebApp?: TelegramWebApp }; WebApp?: TelegramWebApp };
      return channel === "max" ? w.WebApp : w.Telegram?.WebApp;
    };
    // Объект уже есть (скрипт подключён мессенджером или нами раньше).
    if (channel === "max" ? win.WebApp : win.Telegram?.WebApp) {
      tune(current());
      return;
    }
    if (document.getElementById(SCRIPT_ID)) return;

    const load = (sources: string[]) => {
      const [src, ...rest] = sources;
      if (!src) return;
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = src;
      script.async = true;
      script.onload = () => tune(current());
      // Не загрузился — следующий адрес; кончились — молча: значит просто
      // нет этих удобств.
      script.onerror = () => {
        script.remove();
        load(rest);
      };
      document.head.appendChild(script);
    };
    load(BRIDGE[channel]);
  }, []);

  return null;
}
