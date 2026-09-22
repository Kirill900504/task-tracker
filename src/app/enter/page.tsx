"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Вход по ссылке из мессенджера — без пароля.
//
// Зачем эта страница есть. В MAX кнопки мини-приложения нет (её установка
// отправляет бота на повторную модерацию — решение Кирилла), поэтому
// ссылка из чата открывается во ВНЕШНЕМ браузере телефона. Там нет ни
// подписи мессенджера, ни сессии, и человек упирается в форму входа с
// корпоративным паролем, которого не помнит. Для половины людей трекер на
// этом и заканчивался.
//
// Устроена она как /app и /reset-password: меняет одноразовый код на
// сессию и уходит. Кода в адресе нет ни секунды дольше нужного — он
// вычищается сразу, иначе перезагрузка страницы со сгоревшим токеном
// выглядит как «ссылка не работает».
//
// Экран почти пустой нарочно: человек здесь не задерживается. Видно его
// секунду — и только если что-то пошло не так, он становится страницей с
// объяснением, а не пустым белым полем.
export default function EnterPage() {
  const [failed, setFailed] = useState("");

  useEffect(() => {
    const supabase = createClient();
    const tokenHash = new URLSearchParams(window.location.search).get("token_hash");

    // Без кода сюда приходят двумя способами: ссылку открыли второй раз
    // (код уже сгорел, но сессия есть) или адрес набрали руками. В первом
    // случае это просто «открыть трекер», во втором — форма входа.
    if (!tokenHash) {
      supabase.auth.getSession().then(({ data }) => {
        window.location.replace(data.session ? "/" : "/login");
      });
      return;
    }

    supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash }).then(({ error }) => {
      window.history.replaceState(null, "", window.location.pathname);
      if (!error) {
        window.location.replace("/");
        return;
      }
      // Ссылка одноразовая и живёт час: чаще всего сюда приходят с уже
      // использованной. Если сессия при этом есть — человек всё равно
      // внутри, и объяснять нечего.
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) window.location.replace("/");
        else setFailed("Ссылка больше не действует — попросите у бота новую: напишите ему «вход».");
      });
    });
  }, []);

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">{failed ? "Не получилось войти" : "Входим…"}</h1>
        {failed ? (
          <>
            <p className="auth-sub">{failed}</p>
            <button className="auth-btn" onClick={() => window.location.replace("/login")}>
              Войти паролем
            </button>
          </>
        ) : (
          <p className="auth-sub">Секунду — открываю трекер.</p>
        )}
      </div>
    </div>
  );
}
