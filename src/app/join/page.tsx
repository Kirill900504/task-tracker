"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { emailProblem, passwordProblem } from "@/lib/workspaceInvite";

// Where a manager comes in. This is the whole of registration: no link from
// anywhere, no form to find, nothing to sign up for — you are here because
// somebody sent you this address with a code in it.
//
// The name is fetched before anything is typed, because the first question
// in the head of a person opening an unexpected link is "is this for me".
// Seeing his own name answers it faster than any amount of explanation.

function JoinForm() {
  const router = useRouter();
  const code = useSearchParams().get("code") || "";

  // The result of checking the code: null while it is in flight. A link with
  // no code at all is not a state to store — it is knowable during render,
  // and setting it from inside the effect is exactly what the React compiler
  // lint forbids.
  const [checked, setChecked] = useState<{ name?: string; error?: string } | null>(null);
  const checkResult = code ? checked : { error: "В ссылке нет кода приглашения. Попросите прислать её ещё раз." };
  const checking = !checkResult;
  const invitedName = checkResult?.name || "";
  const inviteError = checkResult?.error || "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!code) return;
    fetch(`/api/workspace/join?code=${encodeURIComponent(code)}`)
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        if (cancelled) return;
        if (!data || data.error) {
          setChecked({ error: data?.error || "Не получилось проверить приглашение" });
          return;
        }
        setChecked({ name: data.name || "" });
        // Prefilled only when the owner addressed the invitation to a
        // particular mailbox — otherwise the person types his own.
        if (data.email) setEmail(data.email);
      })
      .catch(() => {
        if (cancelled) return;
        setChecked({ error: "Не получилось проверить приглашение — попробуйте открыть ссылку ещё раз" });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    // Checked here as well as on the server: the point is to say what is
    // wrong while the person is still looking at the field, not after a
    // round trip.
    const problem = emailProblem(email) || passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== repeat) return setError("Пароли не совпадают");

    setBusy(true);
    const res = await fetch("/api/workspace/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, email, password }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) {
      setBusy(false);
      setError(data?.error || "Не получилось принять приглашение");
      return;
    }

    // The account exists now; signing in is the ordinary path, so there is
    // no special "just registered" session to reason about anywhere else.
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) {
      setError("Аккаунт создан, но войти не удалось. Откройте страницу входа и войдите с этой почтой и паролем.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="modal" style={{ maxWidth: 380, width: "100%" }}>
        {checking && <div className="empty">Проверяем приглашение…</div>}

        {!checking && inviteError && (
          <>
            <h2>Приглашение не действует</h2>
            <p style={{ fontSize: 13, marginBottom: 16 }}>{inviteError}</p>
            <div className="modal-actions">
              <div className="left" />
              <div className="left">
                <button type="button" className="btn" onClick={() => router.push("/login")}>
                  Ко входу
                </button>
              </div>
            </div>
          </>
        )}

        {!checking && !inviteError && (
          <>
            <h2>{invitedName ? `${invitedName}, добро пожаловать` : "Добро пожаловать"}</h2>
            <p style={{ fontSize: 13, marginBottom: 16 }}>
              Придумайте пароль — дальше вы будете входить с этой почтой и паролем. Здесь вы увидите задачи и встречи,
              которые вас касаются.
            </p>

            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="joinEmail">Почта</label>
                <input
                  id="joinEmail"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="joinPassword">Пароль</label>
                <input
                  id="joinPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="joinRepeat">Пароль ещё раз</label>
                <input
                  id="joinRepeat"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  required
                />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 12 }}>
                <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
                Показать пароль
              </label>

              {error && <div className="team-error">{error}</div>}

              <div className="modal-actions">
                <div className="left" />
                <div className="left">
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? "Заходим…" : "Войти в трекер"}
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// useSearchParams() has to be read inside a boundary, or the build refuses
// to prerender the page at all.
export default function JoinPage() {
  return (
    <Suspense fallback={<div className="empty">Загрузка…</div>}>
      <JoinForm />
    </Suspense>
  );
}
