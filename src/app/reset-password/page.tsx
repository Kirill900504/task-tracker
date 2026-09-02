"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Landed on via the email link from resetPasswordForEmail() (login page).
// The Supabase browser client auto-exchanges the link's code for a
// short-lived recovery session on load (detectSessionInUrl, on by
// default) — this page just waits for that, then lets the user set a new
// password with it.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="modal" style={{ maxWidth: 360, width: "100%" }}>
        <h2>Новый пароль</h2>

        {!ready && !done && (
          <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>Проверяю ссылку…</p>
        )}

        {ready && !done && (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="newPassword">Новый пароль</label>
              <input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="confirmPassword">Повторите пароль</label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            {error && <div style={{ color: "var(--high)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <div className="modal-actions">
              <div className="left" />
              <div className="left">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? "Сохраняю…" : "Сохранить пароль"}
                </button>
              </div>
            </div>
          </form>
        )}

        {done && (
          <p style={{ fontSize: 13, color: "var(--ink)" }}>✓ Пароль сохранён, перехожу в трекер…</p>
        )}
      </div>
    </div>
  );
}
