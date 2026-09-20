"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Трекер, открытый внутри мессенджера.
//
// Единственное, что эта страница делает, — меняет «я тот, кто открыл это
// окно» на сессию и уходит на сам трекер. Пароля здесь нет и быть не
// может: личность подтверждает мессенджер своей подписью, а проверяет её
// /api/<мессенджер>/miniapp-auth.
//
// Зачем: Кирилл 20.09.2026 — «если люди вне офиса им не всегда будет кайф
// открывать приложения, а мессенджеры у них ОТКРЫТЫ ВСЕГДА». Открыть
// трекер из чата, где ты и так сидишь, стоит одного нажатия; вспомнить
// корпоративную почту и пароль к ней — не стоит ничего, потому что этого
// просто не делают.
//
// Одна страница на оба мессенджера, а не две похожих: разница между ними
// здесь — имя параметра в адресе и адрес маршрута, всё остальное слово в
// слово одно и то же.
//
// Экран нарочно почти пустой: человек здесь не задерживается. Виден он
// секунду — и только если что-то пошло не так, становится страницей с
// объяснением, а не пустым белым полем в окне без адресной строки.

// `detail` — строка для меня, а не для человека: имена полей, которые
// прислал мессенджер. Появилась 20.09.2026, когда вход не работал у всех
// и выяснить причину было нечем: настоящую подпись Telegram на нашей
// стороне не повторить, а отказ говорил только «не сходится». Показана
// мелко и внизу — человеку с неё толку нет, но один снимок экрана
// заменяет день переписки.
type Stage = { kind: "working" } | { kind: "failed"; message: string; canRetry: boolean; detail?: string };

type Launch = { channel: "telegram" | "max"; initData: string };

// Чем нас представил мессенджер.
//
// Данные берутся двумя способами нарочно. Объект `window.Telegram.WebApp`
// (и `window.WebApp` у MAX) появляется, только если загрузился скрипт с
// чужого домена: заблокируй его сеть, расширение или медленный мобильный
// интернет — и вход перестанет работать без единого слова в объяснение.
// Те же данные оба мессенджера кладут в адрес окна, и оттуда их не отнять.
//
// Telegram кладёт их под именем `tgWebAppData`, MAX — под `WebAppData`
// (dev.max.ru, «Валидация данных»). По этому имени и различаем, откуда
// человек пришёл: гадать по названию браузера незачем, когда мессенджер
// представился сам.
function readLaunch(): Launch | null {
  const win = window as unknown as {
    Telegram?: { WebApp?: { initData?: string } };
    WebApp?: { initData?: string };
  };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  const telegram = win.Telegram?.WebApp?.initData || hash.get("tgWebAppData");
  if (telegram) return { channel: "telegram", initData: telegram };

  const max = hash.get("WebAppData") || win.WebApp?.initData;
  if (max) return { channel: "max", initData: max };

  return null;
}

export default function MiniApp() {
  const [stage, setStage] = useState<Stage>({ kind: "working" });

  useEffect(() => {
    let cancelled = false;

    async function signIn() {
      const launch = readLaunch();
      if (!launch) {
        // Открыли в обычном браузере — и это не ошибка, а нормальный
        // случай: в MAX кнопка «Открыть трекер» пока обычная ссылка
        // (мини-приложения там нет, см. docs/bot-menu.md), и открывается
        // она снаружи. Человека надо просто отвести туда, куда он шёл:
        // в трекер, если он уже вошёл, и на форму входа, если нет.
        // Страница с объяснением на его месте была бы тупиком, из
        // которого он всё равно пошёл бы теми же двумя путями.
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        window.location.replace(data.session ? "/" : "/login");
        return;
      }

      try {
        const res = await fetch(`/api/${launch.channel}/miniapp-auth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: launch.initData }),
        });
        const body = (await res.json().catch(() => null)) as
          | { tokenHash?: string; error?: string; fields?: string[] }
          | null;
        if (!res.ok || !body?.tokenHash) {
          if (!cancelled) {
            setStage({
              kind: "failed",
              message: body?.error || "Не получилось войти.",
              canRetry: res.status >= 500,
              detail: body?.fields?.length ? `${launch.channel}, поля: ${body.fields.join(", ")}` : undefined,
            });
          }
          return;
        }

        const supabase = createClient();
        const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: body.tokenHash });
        if (error) {
          if (!cancelled) {
            setStage({ kind: "failed", message: "Код входа не подошёл — закройте окно и откройте заново.", canRetry: true });
          }
          return;
        }

        // Заменой, а не переходом: возвращаться отсюда некуда —
        // одноразовый код уже сгорел, и эта страница, открытая из
        // истории, показала бы ошибку на ровном месте.
        window.location.replace("/");
      } catch {
        if (!cancelled) {
          setStage({ kind: "failed", message: "Нет связи с трекером. Проверьте интернет и попробуйте ещё раз.", canRetry: true });
        }
      }
    }

    // Окно мессенджера открывается половинной высоты и ждёт, что
    // приложение о себе заявит. Обе команды необязательны: без скрипта их
    // просто нет, и это ничего не ломает — вход от них не зависит.
    const win = window as unknown as {
      Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } };
      WebApp?: { ready?: () => void; expand?: () => void };
    };
    for (const app of [win.Telegram?.WebApp, win.WebApp]) {
      app?.ready?.();
      app?.expand?.();
    }

    signIn();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">{stage.kind === "working" ? "Входим…" : "Не вышло войти"}</h1>
        {stage.kind === "working" ? (
          <p className="auth-sub">Секунду — открываю трекер.</p>
        ) : (
          <>
            <p className="auth-sub">{stage.message}</p>
            {stage.canRetry && (
              <button className="auth-btn" onClick={() => window.location.reload()}>
                Попробовать ещё раз
              </button>
            )}
            {stage.detail && (
              <p style={{ marginTop: 18, fontSize: 11, opacity: 0.45, wordBreak: "break-all" }}>{stage.detail}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
