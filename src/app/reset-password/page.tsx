"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Landed on via the email link from resetPasswordForEmail() (login page).
// The Supabase browser client auto-exchanges the link's code for a
// short-lived recovery session on load (detectSessionInUrl, on by
// default) — this page just waits for that, then lets the user set a new
// password with it.
//
// Same shell as /login and /join (.auth-* in tracker.css).
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    // Covers the case where the recovery session was already established by
    // the time this effect runs (event fired before the listener attached).
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Пароль должен быть не короче 6 символов.");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError("Не получилось сохранить пароль: " + error.message);
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1500);
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size local logo; next/image adds nothing */}
          <img src="/favicon.png" alt="" />
          <span>РОКАС</span>
        </div>

        <h1 className="auth-title">Новый пароль</h1>

        {!ready && !done && <p className="auth-sub" style={{ margin: 0 }}>Проверяю ссылку…</p>}

        {ready && !done && (
          <>
            <p className="auth-sub">Задайте пароль, с которым будете входить дальше.</p>
            <form onSubmit={handleSubmit}>
              {error && <div className="auth-error">{error}</div>}

              <div className="auth-field has-peek">
                <label htmlFor="newPassword">Новый пароль</label>
                <input
                  id="newPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
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

              <div className="auth-field">
                <label htmlFor="confirmPassword">Повторите пароль</label>
                <input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="auth-btn" disabled={loading}>
                {loading ? "Сохраняю…" : "Сохранить пароль"}
              </button>
            </form>
          </>
        )}

        {done && <p className="auth-sub" style={{ margin: 0 }}>✓ Пароль сохранён, перехожу в трекер…</p>}
      </div>
    </div>
  );
}
