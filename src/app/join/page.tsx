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
//
// It is also the first thing anyone ever sees of this tracker, which is why
// it is not a dialog box floating in an empty page — see .auth-* in
// tracker.css, shared with /login and /reset-password.

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
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size local logo; next/image adds nothing */}
          <img src="/favicon.png" alt="" />
          <span>РОКАС</span>
        </div>

        {checking && <p className="auth-sub" style={{ margin: 0 }}>Проверяем приглашение…</p>}

        {!checking && inviteError && (
          <>
            <h1 className="auth-title">Приглашение не действует</h1>
            <p className="auth-sub">{inviteError}</p>
            <button type="button" className="auth-btn auth-btn-quiet" onClick={() => router.push("/login")}>
              Перейти ко входу
            </button>
          </>
        )}

        {!checking && !inviteError && (
          <>
            <h1 className="auth-title">{invitedName ? `${invitedName}, добро пожаловать` : "Добро пожаловать"}</h1>
            <p className="auth-sub">
              Придумайте пароль — дальше вы будете входить с этой почтой и паролем. Здесь вы увидите задачи и встречи,
              которые вас касаются.
            </p>

            <form onSubmit={handleSubmit}>
              {error && <div className="auth-error">{error}</div>}

              <div className="auth-field">
                <label htmlFor="joinEmail">Почта</label>
                <input
                  id="joinEmail"
                  type="email"
                  autoComplete="email"
                  placeholder="ivanov@company.ru"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="auth-field has-peek">
                <label htmlFor="joinPassword">Пароль</label>
                <input
                  id="joinPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="не короче 8 символов"
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

              <button type="submit" className="auth-btn" disabled={busy}>
                {busy ? "Заходим…" : "Войти в трекер"}
              </button>
            </form>

            <p className="auth-hint">
              Ссылка одноразовая и действует 7 дней. Если не сработала — попросите прислать новую.
            </p>
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
    <Suspense
      fallback={
        <div className="auth-screen">
          <div className="auth-card">
            <p className="auth-sub" style={{ margin: 0 }}>Загрузка…</p>
          </div>
        </div>
      }
    >
      <JoinForm />
    </Suspense>
  );
}
