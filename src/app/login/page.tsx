"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// The front door. Shares its look with /join and /reset-password (.auth-*
// in tracker.css) — they are one screen with different words on it, and
// three hand-styled near-copies is how three screens drift apart.
//
// There is no "register" link and there will not be one: an account here
// exists because the owner invited the person (see /join).

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Forgot-password (spec-audit recommendation #3): self-service recovery
  // instead of the only path being "ask Кирилл to fix it by hand".
  const [mode, setMode] = useState<"signin" | "forgot" | "sent">("signin");
  const [resetEmail, setResetEmail] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("Не удалось войти: проверьте почту и пароль.");
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
      <span>РОКАС</span>
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

        <form onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}

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
              {showPassword ? "скрыть" : "показать"}
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
