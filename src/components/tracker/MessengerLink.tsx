"use client";

import { useState } from "react";
import type { MessengerState } from "@/hooks/useMyMessenger";
import type { ColleagueChannel } from "@/hooks/useColleagues";

// «Подключить себе бота» — глазами руководителя.
//
// Почему не одна кнопка «Открыть Telegram», как у владельца: этот экран
// открывают с телефона, и довольно часто — из встроенного браузера самого
// мессенджера. Там window.open молча не срабатывает, а системные окна
// (alert/prompt) могут не показаться вовсе. Поэтому здесь нет ни одного
// системного окна, ссылка — настоящий <a>, который переживает и webview, и
// блокировщик всплывающих окон, а рядом всегда виден код: восемь символов,
// которые можно просто отправить боту сообщением, если ссылка не открылась.
// Бот принимает такой код как обычный текст — это тот же путь, не запасной.
//
// И кнопка «Проверить»: подключение случается в другом приложении, человек
// возвращается на эту вкладку, и ему надо увидеть результат, а не догадаться
// обновить страницу.

const LABEL: Record<ColleagueChannel, string> = { telegram: "Telegram", max: "MAX" };

export default function MessengerLink({ messenger }: { messenger: MessengerState }) {
  const [pending, setPending] = useState<{ channel: ColleagueChannel; link: string; code: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const { telegram, max, loading } = messenger;
  const connected = telegram.connected || max.connected;

  async function ask(channel: ColleagueChannel) {
    setError("");
    setBusy(true);
    try {
      const result = await messenger.connect(channel);
      if (!result.ok) setError(result.error);
      else setPending({ channel, link: result.link, code: result.code });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  const offer: ColleagueChannel[] = [];
  if (!telegram.connected) offer.push("telegram");
  if (max.available && !max.connected) offer.push("max");

  return (
    <div className={"ms-link" + (connected ? " ms-link-quiet" : "")}>
      <div className="ms-link-state">
        {telegram.connected && (
          <span className="ms-link-on">
            ✓ Telegram{telegram.username ? ` — @${telegram.username}` : ""}
          </span>
        )}
        {max.connected && (
          <span className="ms-link-on">
            ✓ MAX{max.username ? ` — @${max.username}` : ""}
          </span>
        )}
        {!connected && (
          <div className="ms-link-why">
            <b>Мессенджер не подключён.</b> Задачи, напоминания о встречах и кнопки «Принял / Сделал» приходят туда — без
            этого они будут ждать вас только здесь.
          </div>
        )}
      </div>

      {!!offer.length && (
        <div className="ms-link-actions">
          {offer.map((channel) => (
            <button
              key={channel}
              className={"btn btn-small" + (connected ? "" : " btn-primary")}
              type="button"
              disabled={busy}
              onClick={() => void ask(channel)}
            >
              {busy ? "Готовлю…" : `Подключить ${LABEL[channel]}`}
            </button>
          ))}
          {connected && (
            <button className="btn btn-small" type="button" onClick={messenger.refresh}>
              Проверить
            </button>
          )}
        </div>
      )}

      {error && <div className="ms-link-error">{error}</div>}

      {pending && (
        <div className="ms-link-code">
          <a className="btn btn-small btn-primary" href={pending.link} target="_blank" rel="noreferrer">
            Открыть {LABEL[pending.channel]} →
          </a>
          <div className="ms-link-hint">
            В боте нажмите «Начать». Если ссылка не открылась — напишите боту это сообщение:
          </div>
          <div className="ms-link-value">{pending.code}</div>
          <button className="btn btn-small" type="button" onClick={messenger.refresh}>
            Готово, проверить
          </button>
        </div>
      )}
    </div>
  );
}
