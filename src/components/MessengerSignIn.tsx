"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MaxBrandIcon, TelegramBrandIcon } from "@/components/tracker/MessengerBrandIcon";

// «Войти через Telegram / MAX» на странице входа (lib/messengerLogin).
//
// Главная дорога — запрос, который приходит в чат САМ (lib/loginPush,
// 30.10.2026): человек пишет фамилию или почту, бот присылает вопрос, и
// мессенджер показывает его уведомлением на всех устройствах. До этого
// кнопка была ссылкой t.me, и браузер компьютера открывал не Telegram, а
// страницу «Start bot / Open in Web» — лишний шаг, на котором и вставали.
// В чате человек нажимает число, которое видит здесь (сверка: чужой номер
// ввести может кто угодно, а число видит только тот, кто входит).
//
// Ссылка на бота осталась запасной — для того, кого по фамилии и почте
// не нашли. На компьютере она ведёт в приложение Telegram
// напрямую (tg://), минуя ту же страницу t.me. Запрос заводится заранее,
// при открытии страницы: ссылку, полученную после `await`, браузер открыть
// уже не даст.
//
// Дальше страница спрашивает раз в две секунды, ответил ли человек в боте.
// Ответил верным числом — код меняется на сессию здесь же, в этом окне.

type Request = { token: string; code: number | null; telegram: string | null; max: string | null };
type Channel = "telegram" | "max";

const LABEL: Record<Channel, string> = { telegram: "Telegram", max: "MAX" };
// Чем входили в прошлый раз — чтобы не набирать снова после выхода.
const WHO_KEY = "rokas.loginWho";

// Что сказать, если запрос не ушёл (lib/loginPush, PushOutcome).
function failureText(outcome: string, who: string, label: string): string {
  switch (outcome) {
    case "not_found":
      return `Не нашли вас по «${who}». Напишите фамилию так, как она записана в трекере.`;
    case "vague":
      return `По «${who}» нашлось несколько человек — напишите имя и фамилию.`;
    case "not_connected":
      return `У вас не подключён ${label}. Войдите через другой мессенджер или откройте бота ссылкой ниже.`;
    case "too_many":
      return "Запросов было слишком много — подождите десять минут.";
    default:
      return `${label} сейчас не принял сообщение — попробуйте ещё раз или откройте бота ссылкой ниже.`;
  }
}

async function createRequest(): Promise<Request | null> {
  try {
    const res = await fetch("/api/login-request", { method: "POST" });
    const data = (await res.json().catch(() => null)) as Request | null;
    if (!res.ok || !data?.token || (!data.telegram && !data.max)) return null;
    return data;
  } catch {
    // Нет связи — кнопок просто нет, пароль остаётся.
    return null;
  }
}

// t.me на компьютере — это веб-страница с кнопкой «Start bot»; tg:// сразу
// открывает установленное приложение. На телефоне t.me и так уводит в
// приложение, а tg:// без установленного Telegram не делает ничего.
function botHref(link: string): string {
  const m = /^https:\/\/t\.me\/([A-Za-z0-9_]+)\?start=([A-Za-z0-9]+)$/.exec(link);
  if (!m || typeof window === "undefined" || window.matchMedia("(pointer: coarse)").matches) return link;
  return `tg://resolve?domain=${m[1]}&start=${m[2]}`;
}

function readWho(): string {
  try {
    const saved = typeof window === "undefined" ? "" : localStorage.getItem(WHO_KEY) || "";
    // Номер, запомненный до 30.10.2026, когда в поле принимали телефон, —
    // по нему больше не ищут, и подставлять его значит снова «не нашли».
    return /\p{L}/u.test(saved) ? saved : "";
  } catch {
    return "";
  }
}

// `orLabel` — что ниже кнопок: на входе это почта с паролем, а в
// «Восстановлении пароля» пароля как раз нет — там ниже ссылка в мессенджер.
export default function MessengerSignIn({ orLabel = "или почтой и паролем" }: { orLabel?: string } = {}) {
  const [request, setRequest] = useState<Request | null>(null);
  const [pick, setPick] = useState<Channel | "">("");
  const [waiting, setWaiting] = useState<Channel | "">("");
  const [pushed, setPushed] = useState(false);
  const [who, setWho] = useState(readWho);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");
  const tokenRef = useRef("");

  const fresh = useCallback(async () => {
    const data = await createRequest();
    if (!data) return;
    tokenRef.current = data.token;
    setRequest(data);
  }, []);

  useEffect(() => {
    // Запрос — до нажатия (см. выше); состояние ставится в ответе сети.
    let alive = true;
    createRequest().then((data) => {
      if (!alive || !data) return;
      tokenRef.current = data.token;
      setRequest(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      const token = tokenRef.current;
      if (!token || stopped) return;
      const res = await fetch(`/api/login-request?token=${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { state?: string; tokenHash?: string } | null;
      if (!data || stopped) return;
      if (data.state === "approved" && data.tokenHash) {
        stopped = true;
        window.clearInterval(timer);
        const { error } = await createClient().auth.verifyOtp({ type: "magiclink", token_hash: data.tokenHash });
        if (error) {
          setWaiting("");
          setNote("Не получилось войти — нажмите кнопку ещё раз.");
          void fresh();
          return;
        }
        window.location.replace("/");
        return;
      }
      if (data.state === "refused" || data.state === "expired") {
        stopped = true;
        window.clearInterval(timer);
        setWaiting("");
        setNote(data.state === "refused" ? "Вход отклонён в мессенджере." : "Время вышло — нажмите кнопку ещё раз.");
        void fresh();
      }
    }, 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [waiting, fresh]);

  async function sendPush(channel: Channel) {
    const value = who.trim();
    if (!value || sending) return;
    setSending(true);
    setNote("");
    try {
      const res = await fetch("/api/login-request", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenRef.current, channel, who: value }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; outcome?: string } | null;
      if (!res.ok) {
        setNote(data?.error || "Не получилось отправить запрос — попробуйте ещё раз.");
        if (res.status === 409) void fresh();
        return;
      }
      if (data?.outcome !== "sent") {
        setNote(failureText(data?.outcome || "", value, LABEL[channel]));
        return;
      }
      try {
        localStorage.setItem(WHO_KEY, value);
      } catch {
        /* запомнить не вышло — в следующий раз наберут заново */
      }
      setPushed(true);
      setWaiting(channel);
    } catch {
      setNote("Нет связи с трекером — проверьте интернет и попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  }

  if (!request) return null;

  const linkOf = (channel: Channel) => {
    const link = channel === "telegram" ? request.telegram : request.max;
    return link ? botHref(link) : null;
  };
  const openBot = (channel: Channel) => {
    const href = linkOf(channel);
    if (!href) return null;
    // tg:// открывает приложение, новая вкладка ему не нужна — она осталась
    // бы пустой.
    const external = href.startsWith("http");
    return (
      <a
        className="auth-link ms-signin-open"
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        onClick={() => {
          setNote("");
          setPushed(false);
          setWaiting(channel);
        }}
      >
        Открыть бота в {LABEL[channel]}
      </a>
    );
  };

  return (
    <div className="ms-signin" id="messengerSignIn">
      {waiting ? (
        <div className="ms-signin-wait" role="status">
          <span className="ms-signin-spin" aria-hidden />
          <div>
            <b>{pushed ? `Запрос отправлен в ${LABEL[waiting]}` : `Ждём подтверждения в ${LABEL[waiting]}`}</b>
            {request.code != null ? (
              <div className="ms-signin-code-row">
                Нажмите в чате с ботом число <span className="ms-signin-code" id="loginCode">{request.code}</span> — трекер откроется здесь сам.
              </div>
            ) : (
              <div className="auth-hint" style={{ margin: "4px 0 0" }}>
                Нажмите в чате с ботом «✅ Да, войти» — трекер откроется здесь сам.
              </div>
            )}
            {pushed && (
              <div className="auth-hint" style={{ margin: "6px 0 0" }}>
                Не пришло за полминуты — проверьте чат с ботом в {LABEL[waiting]} или откройте его отсюда:{" "}
                {openBot(waiting)}
              </div>
            )}
          </div>
          <button type="button" className="auth-link" onClick={() => setWaiting("")}>
            Отмена
          </button>
        </div>
      ) : pick ? (
        <form
          className="ms-signin-who"
          onSubmit={(e) => {
            e.preventDefault();
            void sendPush(pick);
          }}
        >
          <div className="auth-field">
            <label htmlFor="msWho">Ваша фамилия или почта</label>
            <input
              id="msWho"
              type="text"
              autoComplete="username"
              autoFocus
              placeholder="Иванов"
              value={who}
              onChange={(e) => setWho(e.target.value)}
            />
          </div>
          <button type="submit" className="auth-btn ms-signin-btn" id="msPushBtn" disabled={sending || !who.trim()}>
            {pick === "telegram" ? <TelegramBrandIcon size={18} /> : <MaxBrandIcon size={18} />}
            {sending ? "Отправляем…" : `Прислать запрос в ${LABEL[pick]}`}
          </button>
          <div className="ms-signin-alt">
            {openBot(pick)}
            <button type="button" className="auth-link" onClick={() => setPick("")}>
              Назад
            </button>
          </div>
          {note && <div className="auth-hint">{note}</div>}
        </form>
      ) : (
        <>
          {request.telegram && (
            <button type="button" className="auth-btn ms-signin-btn" onClick={() => { setNote(""); setPick("telegram"); }}>
              <TelegramBrandIcon size={18} /> Войти через Telegram
            </button>
          )}
          {request.max && (
            <button type="button" className="auth-btn auth-btn-quiet ms-signin-btn" onClick={() => { setNote(""); setPick("max"); }}>
              <MaxBrandIcon size={18} /> Войти через MAX
            </button>
          )}
          {note && <div className="auth-hint">{note}</div>}
        </>
      )}
      <div className="ms-signin-or">
        <span>{orLabel}</span>
      </div>
    </div>
  );
}
