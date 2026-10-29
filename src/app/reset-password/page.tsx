"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { passwordProblem } from "@/lib/workspaceInvite";
import PasswordHints from "@/components/PasswordHints";

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
  // Ссылка не подошла: вместо тупика — кнопка за новой (страница входа
  // сразу в режиме «Забыли пароль?», /login?forgot=1).
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    // Пришла ли сессия хоть каким-то путём — для таймера ниже.
    let got = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        got = true;
        setReady(true);
      }
    });

    // Второй способ сюда попасть: ссылка, выданная владельцем в «Команде»
    // (/api/workspace/access-link). В ней не код Supabase, а одноразовый
    // token_hash, и меняет его на сессию эта страница — потому что ссылка
    // через сам Supabase уводит на его Site URL (у нас — на localhost), а
    // человеку нужен адрес трекера. Токен выкусывается из адреса сразу:
    // перезагрузка страницы со сгоревшим токеном иначе выглядит как
    // «ссылка не работает».
    const tokenHash = new URLSearchParams(window.location.search).get("token_hash");
    if (tokenHash) {
      supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash }).then(({ error }) => {
        if (error) {
          setError("Ссылка больше не действует — она одноразовая и живёт час.");
          setExpired(true);
        } else setReady(true);
        window.history.replaceState(null, "", window.location.pathname);
      });
      return () => subscription.unsubscribe();
    }

    // Covers the case where the recovery session was already established by
    // the time this effect runs (event fired before the listener attached).
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        got = true;
        setReady(true);
      }
    });
    // Ни кода в адресе, ни сессии: страницу открыли из закладки, из
    // истории или по обрезанной ссылке. Раньше она оставалась на «Проверяю
    // ссылку…» навсегда; через несколько секунд честно говорим, что
    // ссылка не та, и даём кнопку за новой.
    const giveUp = window.setTimeout(() => {
      if (got) return;
      setError("Ссылка неполная или уже использована.");
      setExpired(true);
    }, 6000);
    return () => {
      window.clearTimeout(giveUp);
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    // Те же требования, что везде (lib/workspaceInvite.PASSWORD_RULES). До
    // 29.10.2026 здесь было своё «не короче 6», и по ссылке восстановления
    // ставился «123456», который не прошёл бы ни в одном другом месте.
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают.");
      return;
    }
    setLoading(true);
    // Через маршрут «Моих данных», а не прямо в Supabase: там правило
    // пароля проверяет сервер (браузерную проверку обходят), там же новый
    // пароль закрывает все прочие входы и в мессенджер уходит «пароль
    // изменён» — если меняли не вы, это первое, по чему вы узнаете.
    const res = await fetch("/api/account/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, recovery: true }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setLoading(false);
    if (!res) {
      setError("Нет связи с трекером — проверьте интернет и нажмите ещё раз.");
      return;
    }
    if (!res.ok || !data?.ok) {
      if (res.status === 401) setExpired(true);
      setError(res.status === 401 ? "Ссылка больше не действует — попросите новую." : "Не получилось сохранить пароль: " + (data?.error || "попробуйте ещё раз"));
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
          <span>Планировщик задач</span>
        </div>

        <h1 className="auth-title">Новый пароль</h1>

        {/* Пока ссылка проверяется, полей ещё нет — и если она не подошла,
            сказать об этом надо здесь же: единственное, что тут есть, это
            строка «Проверяю ссылку…», и остаться с ней навсегда значит
            остаться без объяснения. */}
        {!ready && !done && error && <div className="auth-error">{error}</div>}
        {expired && !done && (
          <button type="button" className="auth-btn" id="resetAgainBtn" onClick={() => router.push("/login?forgot=1")}>
            Получить новую ссылку
          </button>
        )}
        {!ready && !done && !error && <p className="auth-sub" style={{ margin: 0 }}>Проверяю ссылку…</p>}

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
                  {showPassword ? "Скрыть" : "Показать"}
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
              <PasswordHints password={password} repeat={confirm} />

              <button type="submit" className="auth-btn" disabled={loading}>
                {loading ? "Сохраняю…" : "Сохранить пароль"}
              </button>
            </form>
          </>
        )}

        {done && (
          <p className="auth-sub" style={{ margin: 0 }}>
            ✓ Пароль сохранён. На остальных устройствах вход нужно будет повторить. Перехожу в трекер…
          </p>
        )}
      </div>
    </div>
  );
}
