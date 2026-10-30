"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isServiceEmail } from "@/lib/cabinet";

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
// Уже вошли — ссылка не применяется молча (второй аудит 30.10.2026).
// Ссылка входа — это вход ТОГО, кому её выписали: подсунутая в общем чате
// («глянь задачу»), она тихо пересаживала уже вошедшего человека в чужой
// кабинет, и всё, что он дальше писал «у себя» — мысли, отчёты, пароль в
// «Моих данных», — доставалось тому, кто ссылку прислал. Теперь страница
// спрашивает, а по умолчанию открывает свой трекер.
export default function EnterPage() {
  const [failed, setFailed] = useState("");
  const [already, setAlready] = useState<string | null>(null);
  const pending = useRef("");

  async function enterByLink() {
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    const { error } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: pending.current,
    });
    if (!error) window.location.replace("/");
    else {
      setAlready(null);
      setFailed(
        "Ссылка больше не действует — попросите у бота новую: напишите ему «вход».",
      );
    }
  }

  useEffect(() => {
    const supabase = createClient();
    const tokenHash = new URLSearchParams(window.location.search).get(
      "token_hash",
    );

    // Без кода сюда приходят двумя способами: ссылку открыли второй раз
    // (код уже сгорел, но сессия есть) или адрес набрали руками. В первом
    // случае это просто «открыть трекер», во втором — форма входа.
    if (!tokenHash) {
      supabase.auth.getSession().then(({ data }) => {
        window.location.replace(data.session ? "/" : "/login");
      });
      return;
    }

    window.history.replaceState(null, "", window.location.pathname);
    void supabase.auth.getSession().then(({ data: current }) => {
      if (current.session) {
        const u = current.session.user;
        pending.current = tokenHash;
        const name =
          (u.user_metadata?.name as string | undefined) ||
          (isServiceEmail(u.email) ? "" : u.email || "");
        setAlready(name.replace(/\s*\(я\)\s*$/, ""));
        return;
      }
      return supabase.auth
        .verifyOtp({ type: "magiclink", token_hash: tokenHash })
        .then(({ error }) => {
          if (!error) {
            window.location.replace("/");
            return;
          }
          // Ссылка одноразовая и живёт час: чаще всего сюда приходят с уже
          // использованной.
          setFailed(
            "Ссылка больше не действует — попросите у бота новую: напишите ему «вход».",
          );
        });
    });
  }, []);

  if (already !== null) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-title">Вы уже в трекере</h1>
          <p className="auth-sub">
            {already
              ? `Вы вошли как ${already}.`
              : "На этом устройстве вход уже есть."}{" "}
            Ссылка открывает вход того, кому её прислал бот. Если её прислали
            вам в чате с ботом — войдите по ней; если дали другие — не входите.
          </p>
          <button
            className="auth-btn"
            id="enterKeepBtn"
            onClick={() => window.location.replace("/")}
          >
            Открыть мой трекер
          </button>
          <button
            className="auth-btn auth-btn-quiet"
            id="enterSwitchBtn"
            onClick={() => void enterByLink()}
          >
            Войти по ссылке
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">
          {failed ? "Не получилось войти" : "Входим…"}
        </h1>
        {failed ? (
          <>
            <p className="auth-sub">{failed}</p>
            <button
              className="auth-btn"
              onClick={() => window.location.replace("/login")}
            >
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
