"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAsk } from "@/components/Ask";

// Подключение бота MAX — одна страница, на которую можно дать ссылку.
//
// Обычно такое живёт в переменных окружения Vercel. Здесь не может: владелец
// трекера — не технический человек, и «зайдите в панель, Settings →
// Environment Variables, добавьте три строки, нажмите Redeploy» — это ровно
// тот ответ, который в этом проекте считается плохим ответом.
//
// Поэтому всё, что нужно, — вставить сюда токен бота. Секрет вебхука,
// подписку на обновления и имя бота трекер выясняет и настраивает сам
// (см. /api/max/setup). Инструкция на странице, а не в переписке,
// потому что вернуться к ней надо будет ровно там, где её выполняют.
//
// Шаги переписаны в сентябре 2026: MasterBot на /create теперь отвечает
// «создание чат-ботов доступно только в личном кабинете», и старая
// инструкция вела в тупик. Боты создаются в кабинете MAX для бизнеса, и
// он требует подтверждённого юрлица или ИП — отсюда шаг с ИНН, которого
// раньше не было.

type State = { connected: boolean; username: string; name: string; connectedAt: string | null };

// Читается снаружи компонента, как в useColleagues: правило React-компилятора
// запрещает эффекту вызывать то, что само зовёт setState, — состояние
// раскладывается уже в колбэке.
async function readState(): Promise<{ state?: State; error?: string }> {
  try {
    const res = await fetch("/api/max/setup");
    const data = await res.json();
    if (data.error) return { error: data.error as string };
    return { state: data as State };
  } catch {
    return { error: "Не получилось прочитать настройки — обновите страницу." };
  }
}

export default function MaxSetupPage() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const ask = useAsk();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readState().then((result) => {
      if (cancelled) return;
      if (result.error) setLoadError(result.error);
      else if (result.state) setState(result.state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/max/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setToken("");
      setState(data as State);
    } catch (e) {
      setError("Не получилось: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const yes = await ask.confirm({
      question: "Отключить бота MAX?",
      note: "Задачи и встречи перестанут туда приходить. Telegram продолжит работать.",
      okText: "Отключить",
      danger: true,
    });
    if (!yes) return;
    setBusy(true);
    try {
      const res = await fetch("/api/max/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      const data = await res.json();
      if (!data.error) setState(data as State);
    } finally {
      setBusy(false);
    }
  }

  const brand = (
    <div className="auth-brand">
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size local logo; next/image adds nothing */}
      <img src="/favicon.png" alt="" />
      <span>РОКАС</span>
    </div>
  );

  const back = (
    <div className="auth-foot">
      <Link className="auth-link" href="/">
        Назад в трекер
      </Link>
    </div>
  );

  if (loadError) {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card-wide">
          {brand}
          <h1 className="auth-title">Бот в MAX</h1>
          <div className="auth-error">{loadError}</div>
          {back}
        </div>
      </div>
    );
  }

  if (state?.connected) {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card-wide">
          {brand}
          <h1 className="auth-title">Бот в MAX подключён</h1>
          <p className="auth-sub">
            Бот <b style={{ color: "var(--ink)" }}>@{state.username}</b>
            {state.name ? ` (${state.name})` : ""} на связи. В «Команде» рядом с каждым человеком появилась кнопка «MAX» —
            она выдаёт ссылку-приглашение, как в Telegram.
          </p>
          <button type="button" className="auth-btn auth-btn-quiet" onClick={() => void disconnect()} disabled={busy}>
            {busy ? "Отключаю…" : "Отключить бота"}
          </button>
          {back}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card auth-card-wide">
        {brand}
        <h1 className="auth-title">Бот в MAX</h1>
        <p className="auth-sub">
          Бот заводится в кабинете MAX для бизнеса, а сюда вставляется только выданный им токен. Больше ничего
          настраивать не нужно: остальное трекер сделает сам.
        </p>

        <ol className="setup-steps">
          <li>
            Откройте{" "}
            <a href="https://business.max.ru" target="_blank" rel="noreferrer">
              business.max.ru
            </a>{" "}
            и войдите по тому же номеру телефона, что и в MAX.
          </li>
          <li>
            Кабинет попросит подтвердить организацию: ИНН, дальше вход через Госуслуги (от имени руководителя) или через
            Альфа&nbsp;ID / Т-Бизнес&nbsp;ID / Сбербизнес&nbsp;ID. Ботов разрешают только подтверждённым юрлицам и ИП.
          </li>
          <li>
            Раздел <b>Чат-боты</b> → <b>Создать</b>. Название — «РОКАС», адрес должен заканчиваться на{" "}
            <code>_bot</code>, например <code>rokas_tracker_bot</code>.
          </li>
          <li>После создания кабинет покажет токен — длинную строку. Скопируйте её целиком и вставьте в поле ниже.</li>
        </ol>

        <form onSubmit={connect}>
          {error && <div className="auth-error">{error}</div>}

          <div className="auth-field">
            <label htmlFor="maxToken">Токен бота из кабинета</label>
            <input
              id="maxToken"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Вставьте сюда"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="auth-btn" disabled={busy || !token.trim()}>
            {busy ? "Подключаю…" : "Подключить"}
          </button>
        </form>

        <p className="auth-hint">
          Токен — это пароль от бота. Он сохраняется в базе трекера и больше нигде не показывается: даже на этой странице
          после подключения его не видно.
        </p>
        <p className="auth-hint">
          Раньше бота создавал <b>MasterBot</b> командой <code>/create</code> — он больше этого не делает и отвечает, что
          создание переехало в кабинет. Если вы начали там, вернитесь к шагу&nbsp;1.
        </p>
        {back}
      </div>
    </div>
  );
}
