"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hasMessengerLaunch, miniAppRedirect } from "@/lib/messengerLaunch";
import MessengerSignIn from "@/components/MessengerSignIn";
import { warmTracker } from "@/lib/warmTracker";

// The front door. Shares its look with /join and /reset-password (.auth-*
// in tracker.css) — they are one screen with different words on it, and
// three hand-styled near-copies is how three screens drift apart.
//
// There is no "register" link and there will not be one: an account here
// exists because the owner invited the person (see /join).

// useSearchParams на статической странице обязан стоять под Suspense —
// иначе сборка отказывается её пререндерить.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}

function LoginScreen() {
  const router = useRouter();
  // /login?forgot=1 — сразу «Восстановление пароля»: туда ведёт кнопка
  // «Получить новую ссылку» со страницы, где старая не подошла. Без этого
  // человека с просроченной ссылкой отправляли на вход, где ему нечего
  // ввести, и «Забыли пароль?» надо было ещё найти.
  const startForgot = useSearchParams().has("forgot");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Отказ именно по паролю — рядом с ним предлагаем «Забыли пароль?».
  const [wrongPassword, setWrongPassword] = useState(false);

  // Forgot-password (spec-audit recommendation #3): self-service recovery
  // instead of the only path being "ask Кирилл to fix it by hand".
  const [mode, setMode] = useState<"signin" | "forgot" | "sent">(startForgot ? "forgot" : "signin");
  const [resetEmail, setResetEmail] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  // Человека, пришедшего из мини-приложения, здесь быть не должно.
  //
  // Он открыл трекер из бота, где мессенджер уже подтвердил, кто он, —
  // и упёрся в форму, требующую пароль, которого он не помнит. Так
  // выходит, когда ссылка мини-приложения ведёт на корень: сессии нет,
  // middleware отправляет на /login, а данные мессенджера лежат во
  // фрагменте, которого сервер не видит (см. lib/messengerLaunch).
  // Здесь они видны — значит отсюда и уводим на вход по подписи.
  useEffect(() => {
    if (hasMessengerLaunch(window.location.hash)) {
      window.location.replace(miniAppRedirect(window.location.hash));
    }
  }, []);

  // Трекер скачивается, пока человек набирает пароль (lib/warmTracker) — и
  // обычному входу, и входу через мессенджер.
  useEffect(() => {
    warmTracker();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setWrongPassword(false);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      // Нет связи — это не «неверный пароль», и отправлять человека
      // восстанавливать пароль, который у него верный, — худшее, что тут
      // можно сделать.
      const offline = /fetch|network/i.test(error.message);
      setError(offline ? "Нет связи с трекером — проверьте интернет и нажмите «Войти» ещё раз." : "Не подходит почта или пароль.");
      setWrongPassword(!offline);
      return;
    }
    router.push("/");
    router.refresh();
  }

  // Ссылка уходит В МЕССЕНДЖЕР, а не письмом.
  //
  // Письмом она уходила полгода и никуда не приводила: текст письма
  // собирает сам Supabase, подставляя в него Site URL проекта, а он —
  // http://localhost:3000. Нажавший «Забыли пароль?» получал письмо и
  // упирался в пустую страницу на своей машине, а сказать об этом было
  // некому: на экране трекера всё выглядело сработавшим. Починить Site URL
  // можно только в чужой панели, а бот у людей и так привязан — и читают
  // они его сегодня, а не когда доберутся до почты.
  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setResetError("");
    setResetLoading(true);
    const res = await fetch("/api/workspace/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: resetEmail }),
    });
    const data = await res.json().catch(() => null);
    setResetLoading(false);
    if (!res.ok || !data?.ok) {
      setResetError(data?.error || "Не получилось отправить ссылку. Попробуйте ещё раз.");
      return;
    }
    setMode("sent");
  }

  const brand = (
    <div className="auth-brand">
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size local logo; next/image adds nothing */}
      <img src="/favicon.png" alt="" />
      <span>Планировщик задач</span>
    </div>
  );

  if (mode === "sent") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          {brand}
          <h1 className="auth-title">Ссылка отправлена</h1>
          {/* Что делать, если не пришло, сказано здесь и сразу — иначе
              человек, у которого мессенджер не привязан, остаётся перед
              экраном «всё хорошо» и ждёт письма, которого не будет. */}
          <p className="auth-sub">
            Если <b style={{ color: "var(--ink)" }}>{resetEmail}</b> есть в трекере и к ней привязан Telegram или MAX —
            ссылка уже там, в чате с ботом. Она действует час.
          </p>
          <p className="auth-sub">
            Ничего не пришло? Значит мессенджер к этой почте не привязан — попросите ссылку у Кирилла: в «Команде»
            напротив вашего имени есть кнопка «Ссылка ещё раз».
          </p>
          <button type="button" className="auth-btn auth-btn-quiet" onClick={() => setMode("signin")}>
            Назад ко входу
          </button>
        </div>
      </div>
    );
  }

  if (mode === "forgot") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          {brand}
          <h1 className="auth-title">Восстановление пароля</h1>
          <p className="auth-sub">Пришлём ссылку в Telegram или MAX — в тот же чат с ботом, куда приходят задачи.</p>
          {/* Самый короткий путь — вообще без пароля: вход через бота, а
              новый пароль потом задаётся в «Личном кабинете» («Мои данные»)
              без старого (вход через бота его не спрашивает). */}
          <MessengerSignIn orLabel="или ссылкой на новый пароль" />

          <form onSubmit={handleForgotSubmit}>
            {resetError && <div className="auth-error">{resetError}</div>}

            <div className="auth-field">
              <label htmlFor="resetEmail">Почта</label>
              <input
                id="resetEmail"
                type="email"
                autoComplete="email"
                placeholder="ivanov@company.ru"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="auth-btn" disabled={resetLoading}>
              {resetLoading ? "Отправляю…" : "Отправить ссылку"}
            </button>
          </form>

          <p className="auth-hint">
            Вошли через бота — новый пароль задаётся в «Личном кабинете» → «Мои данные», старый не нужен.
          </p>

          <div className="auth-foot">
            <button type="button" className="auth-link" onClick={() => setMode("signin")}>
              Назад ко входу
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        {brand}
        <h1 className="auth-title">Вход в трекер</h1>
        <p className="auth-sub">Задачи, встречи и мысли — то, что касается вас.</p>

        {/* Первым — вход через бота: у большинства людей пароля нет вовсе,
            их кабинет заведён из мессенджера (lib/messengerLogin). */}
        <MessengerSignIn />

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="auth-error" id="loginError">
              {error}
              {wrongPassword && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => {
                      setResetEmail(email);
                      setMode("forgot");
                    }}
                  >
                    Забыли пароль?
                  </button>
                </>
              )}
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="email">Почта</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="ivanov@company.ru"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="auth-field has-peek">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="auth-peek"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
            >
              {showPassword ? "Скрыть" : "Показать"}
            </button>
          </div>

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? "Входим…" : "Войти"}
          </button>
        </form>

        <div className="auth-foot">
          <button
            type="button"
            className="auth-link"
            onClick={() => {
              setResetEmail(email);
              setMode("forgot");
            }}
          >
            Забыли пароль?
          </button>
        </div>
      </div>
    </div>
  );
}
