"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MaxBrandIcon, TelegramBrandIcon } from "@/components/tracker/MessengerBrandIcon";

// «Войти через Telegram / MAX» на странице входа (lib/messengerLogin).
//
// Кнопка — обычная ссылка на бота с токеном запроса. Запрос заводится
// заранее, при открытии страницы, а не по нажатию: ссылку, полученную
// после `await`, браузер открыть в новом окне уже не даст (это «всплывающее
// окно не по нажатию»), а в настольном приложении ссылка и так уходит в
// системный браузер — до Telegram на компьютере.
//
// После нажатия страница спрашивает раз в две секунды, ответил ли человек
// в боте. Ответил «Да» — код меняется на сессию здесь же, в этом окне.

type Request = { token: string; telegram: string | null; max: string | null };

async function createRequest(): Promise<Request | null> {
  try {
    const res = await fetch("/api/login-request", { method: "POST" });
    const data = (await res.json().catch(() => null)) as Request | null;
    if (!res.ok || !data?.token || (!data.telegram && !data.max)) return null;
    return data;
  } catch {
    // Нет связи — кнопок просто нет, пароль остаётся.
    return null;
  }
}

export default function MessengerSignIn() {
  const [request, setRequest] = useState<Request | null>(null);
  const [waiting, setWaiting] = useState<"" | "Telegram" | "MAX">("");
  const [note, setNote] = useState("");
  const tokenRef = useRef("");

  const fresh = useCallback(async () => {
    const data = await createRequest();
    if (!data) return;
    tokenRef.current = data.token;
    setRequest(data);
  }, []);

  useEffect(() => {
    // Запрос — до нажатия (см. выше); состояние ставится в ответе сети.
    let alive = true;
    createRequest().then((data) => {
      if (!alive || !data) return;
      tokenRef.current = data.token;
      setRequest(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      const token = tokenRef.current;
      if (!token || stopped) return;
      const res = await fetch(`/api/login-request?token=${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { state?: string; tokenHash?: string } | null;
      if (!data || stopped) return;
      if (data.state === "approved" && data.tokenHash) {
        stopped = true;
        window.clearInterval(timer);
        const { error } = await createClient().auth.verifyOtp({ type: "magiclink", token_hash: data.tokenHash });
        if (error) {
          setWaiting("");
          setNote("Не получилось войти — нажмите кнопку ещё раз.");
          void fresh();
          return;
        }
        window.location.replace("/");
        return;
      }
      if (data.state === "refused" || data.state === "expired") {
        stopped = true;
        window.clearInterval(timer);
        setWaiting("");
        setNote(data.state === "refused" ? "Вход отклонён в мессенджере." : "Время вышло — нажмите кнопку ещё раз.");
        void fresh();
      }
    }, 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [waiting, fresh]);

  if (!request) return null;

  return (
    <div className="ms-signin" id="messengerSignIn">
      {waiting ? (
        <div className="ms-signin-wait" role="status">
          <span className="ms-signin-spin" aria-hidden />
          <div>
            <b>Ждём подтверждения в {waiting}</b>
            <div className="auth-hint" style={{ margin: "4px 0 0" }}>
              Нажмите в чате с ботом «✅ Да, войти» — трекер откроется здесь сам.
            </div>
          </div>
          <button type="button" className="auth-link" onClick={() => setWaiting("")}>
            Отмена
          </button>
        </div>
      ) : (
        <>
          {request.telegram && (
            <a className="auth-btn ms-signin-btn" href={request.telegram} target="_blank" rel="noopener noreferrer" onClick={() => { setNote(""); setWaiting("Telegram"); }}>
              <TelegramBrandIcon size={18} /> Войти через Telegram
            </a>
          )}
          {request.max && (
            <a className="auth-btn auth-btn-quiet ms-signin-btn" href={request.max} target="_blank" rel="noopener noreferrer" onClick={() => { setNote(""); setWaiting("MAX"); }}>
              <MaxBrandIcon size={18} /> Войти через MAX
            </a>
          )}
          {note && <div className="auth-hint">{note}</div>}
        </>
      )}
      <div className="ms-signin-or">
        <span>или почтой и паролем</span>
      </div>
    </div>
  );
}
