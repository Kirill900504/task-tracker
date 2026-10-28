"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MaxBrandIcon, TelegramBrandIcon } from "@/components/tracker/MessengerBrandIcon";
import Icon from "@/components/tracker/Icon";

// Страница приглашения «всё в одном» (lib/welcomeInvite).
//
// Это первое, что человек видит от трекера, и он пришёл сюда из чата с
// Кириллом — поэтому первое слово на ней его имя: оно отвечает на «это мне?»
// быстрее любых объяснений. Дальше три шага в том порядке, в котором они
// нужны: бот (без него до человека не дойдёт ни одна задача), телефон (он
// уже в боте — ставить нечего) и компьютер (скачать приложение и войти в нём
// тем же ботом, без пароля).
//
// Пока страница открыта, она переспрашивает, подключён ли человек: нажал
// «Start» в Telegram, вернулся сюда — и первый шаг уже с галочкой.

type Info = {
  name: string;
  inviter: string;
  telegram: { link: string; connected: boolean } | null;
  max: { link: string; connected: boolean } | null;
  desktop: { url: string; version: string };
};

export default function WelcomePage() {
  const code = String(useParams<{ code: string }>().code || "");
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch(`/api/welcome?code=${encodeURIComponent(code)}`, { cache: "no-store" }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as (Info & { error?: string }) | null;
      if (!alive) return;
      if (!res) return setError((e) => e || "Нет связи с трекером — проверьте интернет и обновите страницу.");
      if (!data || data.error) return setError(data?.error || "Не получилось открыть приглашение.");
      setError("");
      setInfo(data);
    };
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [code]);

  const brand = (
    <div className="auth-brand">
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size local logo; next/image adds nothing */}
      <img src="/favicon.png" alt="" />
      <span>Планировщик задач</span>
    </div>
  );

  if (!info) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          {brand}
          <h1 className="auth-title">{error ? "Приглашение не открылось" : "Открываю приглашение…"}</h1>
          {error && <p className="auth-sub">{error}</p>}
        </div>
      </div>
    );
  }

  const first = info.name.split(/\s+/)[0] || info.name;
  const connected = !!(info.telegram?.connected || info.max?.connected);

  return (
    <div className="auth-screen">
      <div className="auth-card auth-card-wide welcome-card" id="welcomeCard">
        {brand}
        <h1 className="auth-title">{first}, добро пожаловать!</h1>
        <p className="auth-sub">
          {info.inviter ? `${info.inviter} приглашает вас` : "Вас приглашают"} в планировщик задач команды. Здесь будут
          ваши задачи и встречи — всё, что вы поручаете и что поручают вам. Три шага, пару минут.
        </p>

        <ol className="welcome-steps">
          <li className={"welcome-step" + (connected ? " done" : "")} id="welcomeStepBot">
            <div className="welcome-num">{connected ? "✓" : "1"}</div>
            <div className="welcome-body">
              <h2>Подключите бота</h2>
              <p>
                Туда приходят задачи и встречи — отвечать можно прямо кнопками под сообщением. Выберите мессенджер, который у
                вас есть, и нажмите в нём «Start» («Начать»).
              </p>
              <div className="welcome-buttons">
                {info.telegram && (
                  <a className={"welcome-btn" + (info.telegram.connected ? " on" : "")} href={info.telegram.link} target="_blank" rel="noopener noreferrer" id="welcomeTelegram">
                    <TelegramBrandIcon size={20} />
                    {info.telegram.connected ? "Telegram подключён" : "Telegram"}
                  </a>
                )}
                {info.max && (
                  <a className={"welcome-btn" + (info.max.connected ? " on" : "")} href={info.max.link} target="_blank" rel="noopener noreferrer" id="welcomeMax">
                    <MaxBrandIcon size={20} />
                    {info.max.connected ? "MAX подключён" : "MAX"}
                  </a>
                )}
              </div>
              {connected && <p className="welcome-ok">Готово — вы на связи. Можно подключить и второй мессенджер, про запас.</p>}
            </div>
          </li>

          <li className="welcome-step">
            <div className="welcome-num">2</div>
            <div className="welcome-body">
              <h2>На телефоне</h2>
              <p>
                Ставить ничего не нужно: весь трекер открывается прямо в боте — кнопка «Мобильное приложение» в его меню.
                Без пароля.
              </p>
            </div>
          </li>

          <li className="welcome-step">
            <div className="welcome-num">3</div>
            <div className="welcome-body">
              <h2>На компьютере</h2>
              <p>Приложение для Windows — трекер в своём окне, с уведомлениями поверх других программ. Обновляется само.</p>
              <div className="welcome-buttons">
                <a className="welcome-btn primary" href={info.desktop.url} id="welcomeDownload">
                  <Icon name="download" size={16} /> Скачать для Windows{info.desktop.version ? ` · ${info.desktop.version}` : ""}
                </a>
              </div>
              <p className="welcome-note">
                Windows может показать «Система Windows защитила ваш компьютер» — нажмите «Подробнее», затем «Выполнить в любом
                случае». Это обычное предупреждение для программ без платной подписи.
              </p>
              <p className="welcome-note">
                Войти в приложении — кнопкой «Войти через Telegram» (или MAX): бот спросит «это вы?», и трекер откроется. Пароль
                не нужен.{" "}
                <a className="auth-link" style={{ padding: 0 }} href="/login">
                  Или откройте трекер в браузере
                </a>
                .
              </p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}
