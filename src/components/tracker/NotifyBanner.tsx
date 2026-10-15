"use client";

import { useState } from "react";
import Icon from "./Icon";
import { useAlertPrefs, writeAlertPrefs } from "@/lib/alertPrefs";

// Плашка «Включите уведомления» под шапкой — по образцу корпоративного
// мессенджера, который Кирилл прислал снимком 15.10.2026: «хочу такую же
// штуку внедрить, чтоб в веб приложении и десктопной версии можно было
// глобально включать или выключать уведомления».
//
// Говорит она о двух разных состояниях одними словами, потому что для
// человека это одно и то же — «уведомления до меня не доходят»:
// *выключены в трекере* (общий выключатель в колокольчике, lib/alertPrefs)
// и *браузер ещё не спросили* — разрешение «по умолчанию», при котором
// окна Windows не показываются вовсе. Кнопка «Включить» чинит оба сразу.
// Запрещённое в браузере («denied») здесь не предлагается: снять запрет
// кнопкой со страницы нельзя, а внутри трекера окошки и так всплывают.
//
// Только компьютер: на телефоне уведомления приходят мессенджером, а
// браузер телефона без воркера окон не показывает.
//
// Крестик прячет плашку до следующего открытия трекера, как и напоминание
// о мессенджере (MessengerLink): навсегда — было бы неправдой о том, что
// уведомлений нет, а висеть после «я видел» — раздражать.
const DISMISS_KEY = "rokas:notify-banner-dismissed";

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export default function NotifyBanner({
  permission,
  requestPermission,
}: {
  permission: NotificationPermission | "unsupported";
  requestPermission: () => void;
}) {
  const prefs = useAlertPrefs();
  const [dismissed, setDismissed] = useState(readDismissed);
  const askBrowser = prefs.enabled && permission === "default";
  if (dismissed || (prefs.enabled && !askBrowser)) return null;

  return (
    <div className="notify-banner" id="notifyBanner" role="status">
      <Icon name="bell-off" size={16} />
      <span className="notify-banner-text">
        {prefs.enabled
          ? "Включите уведомления, чтобы не пропускать сообщения коллег и новые задачи"
          : "Уведомления выключены — сообщения коллег и новые задачи не всплывают"}
      </span>
      <button
        type="button"
        className="btn btn-primary notify-banner-on"
        id="notifyBannerOn"
        onClick={() => {
          writeAlertPrefs({ enabled: true, quietUntil: "" });
          if (permission === "default") requestPermission();
        }}
      >
        Включить
      </button>
      <button
        type="button"
        className="notify-banner-close"
        aria-label="Скрыть"
        title="Скрыть до следующего открытия"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* см. readDismissed */
          }
        }}
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
