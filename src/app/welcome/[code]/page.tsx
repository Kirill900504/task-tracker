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
    // Переспрашивать есть смысл, только пока есть чего ждать (аудит
    // 29.10.2026). Раньше опрос раз в четыре секунды шёл, пока вкладка
    // открыта, — и после ответа «приглашение не найдено / истекло», и когда
    // все боты уже подключены: каждый раз это пять обращений к базе и к
    // ботам на сервере, а вкладку с приглашением люди не закрывают днями.
    let done = false;
    const poll: { timer?: number } = {};
    const load = async () => {
      if (done || document.visibilityState !== "visible") return;
      const res = await fetch(`/api/welcome?code=${encodeURIComponent(code)}`, { cache: "no-store" }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as (Info & { error?: string }) | null;
      if (!alive) return;
      if (!res) return setError((e) => e || "Нет связи с трекером — проверьте интернет и обновите страницу.");
      if (!data || data.error) {
        // Ответ сервера по существу (ссылка неверна, истекла) от повтора не
        // изменится; сбой разбора ответа — может, его переспросим.
        if (data?.error) stop();
        return setError(data?.error || "Не получилось открыть приглашение.");
      }
      setError("");
      setInfo(data);
      const bots = [data.telegram, data.max].filter((b): b is { link: string; connected: boolean } => !!b);
      if (bots.length && bots.every((b) => b.connected)) stop();
    };
    function stop() {
      done = true;
      window.clearInterval(poll.timer);
      document.removeEventListener("visibilitychange", load);
    }
    void load();
    poll.timer = window.setInterval(() => void load(), 4000);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      stop();
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
          {info.inviter ? `${info.inviter} приглашает вас` : "Вас приглашают"} в планировщик задач команды — здесь ваши
          задачи и встречи. Три шага, пара минут.
        </p>

        {/* Шаг, который ждёт человека, подсвечен (`current`): пока бот не
            подключён, это первый, после — остальные два сразу. Номера
            связаны линией, чтобы три карточки читались одной дорогой, а не
            тремя отдельными инструкциями. */}
        <ol className="welcome-steps">
          <li className={"welcome-step" + (connected ? " done" : " current")} id="welcomeStepBot">
            <div className="welcome-num">{connected ? <Icon name="check" size={16} /> : "1"}</div>
            <div className="welcome-body">
              <h2>Подключите бота</h2>
              <p>Сюда приходят задачи и встречи, отвечать можно кнопками. Выберите мессенджер и нажмите в нём «Start».</p>
              <div className="welcome-buttons welcome-ms">
                {info.telegram && (
                  <a className={"welcome-btn ms-tg" + (info.telegram.connected ? " on" : "")} href={info.telegram.link} target="_blank" rel="noopener noreferrer" id="welcomeTelegram">
                    <TelegramBrandIcon size={22} />
                    {info.telegram.connected ? "Telegram подключён" : "Telegram"}
                  </a>
                )}
                {info.max && (
                  <a className={"welcome-btn ms-max" + (info.max.connected ? " on" : "")} href={info.max.link} target="_blank" rel="noopener noreferrer" id="welcomeMax">
                    <MaxBrandIcon size={22} />
                    {info.max.connected ? "MAX подключён" : "MAX"}
                  </a>
                )}
              </div>
              {connected && <p className="welcome-ok">Готово — вы на связи. Второй мессенджер можно подключить про запас.</p>}
            </div>
          </li>

          <li className={"welcome-step" + (connected ? " current" : "")}>
            <div className="welcome-num">2</div>
            <div className="welcome-body">
              <h2>На телефоне</h2>
              <p>Ставить ничего не нужно: трекер открывается в боте — кнопка «Мобильное приложение» в его меню.</p>
            </div>
          </li>

          <li className={"welcome-step" + (connected ? " current" : "")}>
            <div className="welcome-num">3</div>
            <div className="welcome-body">
              <h2>На компьютере</h2>
              <p>Приложение для Windows: своё окно, уведомления поверх программ, обновляется само.</p>
              <div className="welcome-buttons">
                <a className="welcome-btn primary" href={info.desktop.url} id="welcomeDownload">
                  <Icon name="download" size={16} /> Скачать для Windows{info.desktop.version ? ` · ${info.desktop.version}` : ""}
                </a>
              </div>
              <p className="welcome-note">
                <Icon name="warning" size={15} />
                <span>
                  Если Windows скажет «защитила ваш компьютер» — нажмите «Подробнее» → «Выполнить в любом случае». Так она
                  встречает любую программу без платной подписи.
                </span>
              </p>
              <p>
                Вход в приложении — «Войти через Telegram» или MAX, без пароля.{" "}
                <a className="auth-link" style={{ padding: 0 }} href="/login">
                  Открыть трекер в браузере
                </a>
              </p>
            </div>
          </li>
        </ol>
        <p className="welcome-after" id="welcomeAfter">
          <Icon name="user" size={16} />
          <span>
            После входа нажмите своё имя вверху трекера и впишите рабочую почту и телефон. Короткое знакомство трекер покажет
            сам.
          </span>
        </p>
      </div>
    </div>
  );
}
