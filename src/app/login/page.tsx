"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setResetError("");
    setResetLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetLoading(false);
    if (error) {
      setResetError("Не получилось отправить ссылку: " + error.message);
      return;
    }
    setMode("sent");
  }

  if (mode === "forgot" || mode === "sent") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div className="modal" style={{ maxWidth: 360, width: "100%" }}>
          <h2>Восстановление пароля</h2>
          {mode === "sent" ? (
            <>
              <p style={{ fontSize: 13, color: "var(--ink)", marginBottom: 16 }}>
                Если <b>{resetEmail}</b> зарегистрирована в трекере — на неё отправлена ссылка для смены пароля. Проверьте почту (и папку «Спам»).
              </p>
              <div className="modal-actions">
                <div className="left" />
                <div className="left">
                  <button type="button" className="btn btn-primary" onClick={() => setMode("signin")}>
                    Назад ко входу
                  </button>
                </div>
              </div>
            </>
          ) : (
            <form onSubmit={handleForgotSubmit}>
              <div className="field">
                <label htmlFor="resetEmail">Почта</label>
                <input
                  id="resetEmail"
                  type="email"
                  autoComplete="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                />
              </div>
              {resetError && <div style={{ color: "var(--high)", fontSize: 13, marginBottom: 12 }}>{resetError}</div>}
              <div className="modal-actions">
                <div className="left">
                  <button type="button" className="btn" onClick={() => setMode("signin")}>
                    Назад
                  </button>
                </div>
                <div className="left">
                  <button type="submit" className="btn btn-primary" disabled={resetLoading}>
                    {resetLoading ? "Отправляю…" : "Отправить ссылку"}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <form onSubmit={handleSubmit} className="modal" style={{ maxWidth: 360, width: "100%" }}>
        <h2>Вход в трекер</h2>

        <div className="field">
          <label htmlFor="email">Почта</label>
          <input
            id="email"
            type="text"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Пароль</label>
          <div style={{ position: "relative" }}>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "8px 34px 8px 10px",
                border: "1px solid var(--line)",
                borderRadius: 6,
                fontFamily: "var(--sans)",
                fontSize: 13,
                background: "var(--paper-soft)",
                color: "var(--ink)",
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? "Скрыть пароль" : "Показать пароль"}
              style={{
                position: "absolute",
                right: 4,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 15,
                padding: "4px 6px",
                lineHeight: 1,
                color: "var(--ink-soft)",
              }}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>
          <button
            type="button"
            className="btn-ghost"
            style={{ marginTop: 6, fontSize: 12, textDecoration: "underline", padding: 0 }}
            onClick={() => {
              setResetEmail(email);
              setMode("forgot");
            }}
          >
            Забыли пароль?
          </button>
        </div>

        {error && (
          <div style={{ color: "var(--high)", fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}

        <div className="modal-actions">
          <div className="left" />
          <div className="left">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Входим…" : "Войти"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
