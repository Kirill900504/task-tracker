"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "1px solid var(--line)",
              borderRadius: 6,
              fontFamily: "var(--sans)",
              fontSize: 13,
              background: "var(--paper-soft)",
              color: "var(--ink)",
            }}
          />
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
