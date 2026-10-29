"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { MessengerState } from "@/hooks/useMyMessenger";
import type { ColleagueChannel } from "@/hooks/useColleagues";
import { emailProblem, passwordProblem } from "@/lib/workspaceInvite";
import { humanError } from "@/lib/humanError";
import { normalizePhone } from "@/lib/phone";
import Modal from "./Modal";
import Icon, { type IconName } from "./Icon";
import MessengerLink from "./MessengerLink";
import ChipChoice from "./ChipChoice";
import { postJson } from "@/lib/postJson";
import { MaxBrandIcon, TelegramBrandIcon } from "./MessengerBrandIcon";
import { AlertSettings } from "./AlertsButton";

// Личный кабинет — всё, что касается самого человека, в одном окне.
//
// 13.10.2026: «ВООБЩЕ ТЫ МОЖЕШЬ УЛУЧШИТЬ СИСТЕМУ ПОДКЛЮЧЕНИЯ НОВЫХ
// ПОЛЬЗОВАТЕЛЕЙ И ВНЕДРИТЬ ПОЛНОЦЕННУЮ РАБОТУ ЛИЧНЫХ КАБИНЕТОВ?» До этого
// кабинет был меню из трёх строк под своим именем, а то, что человеку
// действительно нужно о себе, жило в разных местах или нигде: мессенджер
// подключался плавающей плашкой, которую можно было закрыть и не найти,
// почту, под которой ты записан, нельзя было увидеть вовсе, а пароль
// сменить можно было только через «Забыли пароль?».
//
// Здесь: кто я и с какой ролью; как я вхожу (почта и пароль для
// компьютера — их человек задаёт сам, у кабинета из мессенджера их ещё
// нет); куда мне пишет трекер (мессенджеры, подключение — той же плашкой,
// что и напоминание, а не второй копией); и личные мелочи, которые уже
// были в меню. Права и роли других людей сюда не входят — это «Команда».
//
// 28.10.2026 («модернизируй личные кабинеты, чтобы они могли управлять
// настройками, уведомлениями и прочим») сюда добавлены уведомления — те же
// переключатели, что в колокольчике (AlertSettings), — приложение для
// компьютера постоянной ссылкой /api/download и выход на всех устройствах.
// Порядок — от того, что нужно чаще: куда приходит, что всплывает, как войти,
// чем открывать, и только потом выход.

export type AccountItem = { id: string; label: string; icon: IconName; onSelect: () => void };

export default function AccountModal({
  name,
  roleLabel,
  messenger,
  owner,
  items,
  alerts,
  onProfileSaved,
  onSignOut,
  onClose,
}: {
  name: string;
  roleLabel: string;
  // Мессенджер руководителя — его чат живёт на строке человека.
  messenger: MessengerState | null;
  // У владельца чат на учётной записи (useBotLink): только состояние и
  // кнопка подключения — разбирать его как руководительский нельзя.
  owner: { needs: Record<ColleagueChannel, boolean>; maxAvailable: boolean; link: (c: ColleagueChannel) => void } | null;
  items: AccountItem[];
  alerts: { permission: NotificationPermission | "unsupported"; requestPermission: () => void };
  // Сохранили «Мои данные»: заполнено ли теперь всё — по этому гаснет
  // отметка на имени в шапке.
  onProfileSaved?: (complete: boolean) => void;
  onSignOut: (everywhere?: boolean) => void;
  onClose: () => void;
}) {
  // В настольном приложении скачивать его же незачем; на телефоне — нечем.
  const [desktopOffer] = useState(
    () => typeof navigator !== "undefined" && !/Electron|Android|iPhone|iPad|Mobile/i.test(navigator.userAgent),
  );
  // Что сохранено (null — ещё не прочитано) и что набрано в полях.
  const [saved, setSaved] = useState<{ email: string; phone: string } | null>(null);
  const [draftEmail, setDraftEmail] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/account/credentials")
      .then((res) => res.json())
      .then((data: { email?: string; phone?: string }) => {
        if (!alive) return;
        setSaved({ email: data.email ?? "", phone: data.phone ?? "" });
        setDraftEmail(data.email ?? "");
        setDraftPhone(data.phone ?? "");
      })
      .catch(() => alive && setSaved({ email: "", phone: "" }));
    return () => {
      alive = false;
    };
  }, []);

  const email = saved?.email ?? "";
  const emailChanged = draftEmail.trim().toLowerCase() !== email.toLowerCase();
  const phoneChanged = draftPhone.trim() !== (saved?.phone ?? "");
  const changed = emailChanged || phoneChanged || !!password;

  async function save(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    // Те же проверки, что на сервере, — чтобы сказать о них, пока человек
    // смотрит на поле, а не после похода в сеть.
    const problem =
      (emailChanged && draftEmail.trim() ? emailProblem(draftEmail) : "") ||
      (password ? passwordProblem(password) : "") ||
      (phoneChanged && normalizePhone(draftPhone) === null ? "Не похоже на номер телефона — например, +7 900 123-45-67" : "");
    if (problem) return setNote({ ok: false, text: problem });
    if (emailChanged && draftEmail.trim() && !email && !password) {
      return setNote({ ok: false, text: "Придумайте пароль — без него с компьютера не войти" });
    }
    setBusy(true);
    try {
      const res = await fetch("/api/account/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(emailChanged ? { email: draftEmail } : {}),
          ...(password ? { password } : {}),
          ...(phoneChanged ? { phone: draftPhone } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; email?: string; phone?: string; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setNote({ ok: false, text: data?.error || "Не получилось сохранить" });
        return;
      }
      const next = { email: data.email ?? email, phone: data.phone ?? saved?.phone ?? "" };
      setSaved(next);
      setDraftEmail(next.email);
      setDraftPhone(next.phone);
      setPassword("");
      onProfileSaved?.(!!next.email && !!next.phone);
      setNote({ ok: true, text: password ? "Сохранено. С компьютера можно входить с этой почтой и паролем." : "Сохранено." });
    } catch (err) {
      setNote({ ok: false, text: humanError(err, "Не получилось сохранить") });
    } finally {
      setBusy(false);
    }
  }
  // Выбирать есть из чего, только когда подключены оба: с одним трекер и
  // так пишет в него.
  const bothConnected = messenger
    ? messenger.telegram.connected && messenger.max.connected
    : !!owner && owner.maxAvailable && !owner.needs.telegram && !owner.needs.max;

  return (
    <Modal onClose={onClose} id="accountModal" dismissOnBackdrop={false}>
      <div className="modal account-modal">
        <div className="account-head">
          <div className="account-avatar" aria-hidden>
            {initials(name)}
          </div>
          <div>
            <h2>{name || "Личный кабинет"}</h2>
            <div className="field-hint account-role">{roleLabel}</div>
          </div>
          {/* × в правом верхнем углу — как у всех окон (ItemModalHead). */}
          <button type="button" className="item-head-close account-close" title="Закрыть (Esc)" aria-label="Закрыть" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Первым, сразу под именем: это и есть «второй шаг» после
            подключения бота, и кабинет открывается сам ради него, пока
            данные не заполнены (NewTracker, profileIncomplete). */}
        <section className="account-section" id="accountProfile">
          <h3>Мои данные</h3>
          {saved === null ? (
            <p className="field-hint">Загружаю…</p>
          ) : (
            <form onSubmit={save} className="account-form">
              <p className="field-hint">
                Рабочая почта и телефон — чтобы с вами можно было связаться. Почта с паролем — запасной вход с компьютера;
                основной — кнопкой «Войти через Telegram» (или MAX) на странице входа, без пароля.
              </p>
              <label className="account-field">
                <span>Рабочая почта</span>
                <input
                  id="accountEmail"
                  type="email"
                  autoComplete="email"
                  placeholder="ivanov@company.ru"
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                />
              </label>
              <label className="account-field">
                <span>Телефон</span>
                <input
                  id="accountPhone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="+7 900 123-45-67"
                  value={draftPhone}
                  onChange={(e) => setDraftPhone(e.target.value)}
                />
              </label>
              <label className="account-field">
                <span>{email ? "Новый пароль" : "Пароль"}</span>
                <span className="account-pass">
                  <input
                    id="accountPassword"
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder={email ? "Оставьте пустым, чтобы не менять" : "Не короче 8 символов"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className="btn btn-small" onClick={() => setShow((v) => !v)}>
                    {show ? "Скрыть" : "Показать"}
                  </button>
                </span>
              </label>
              {note && <div className={note.ok ? "account-ok" : "ms-link-error"}>{note.text}</div>}
              <button type="submit" id="accountSaveBtn" className="btn btn-primary btn-small" disabled={busy || !changed}>
                {busy ? "Сохраняю…" : "Сохранить"}
              </button>
            </form>
          )}
        </section>

        <section className="account-section">
          <h3>Мессенджеры</h3>
          <p className="field-hint">
            Туда приходят задачи и встречи с кнопками ответа, а в меню бота — «Мобильное приложение»: весь трекер
            прямо в чате, без пароля.
          </p>
          {messenger && <MessengerLink messenger={messenger} embedded />}
          {owner && (
            <div className="account-owner-ms">
              <span className="ms-link-on">
                <TelegramBrandIcon size={16} /> Telegram — {owner.needs.telegram ? "не подключён" : "подключён"}
              </span>
              {owner.needs.telegram && (
                <button type="button" className="btn btn-small btn-primary" onClick={() => owner.link("telegram")}>
                  Подключить
                </button>
              )}
              {owner.maxAvailable && (
                <>
                  <span className="ms-link-on">
                    <MaxBrandIcon size={16} /> MAX — {owner.needs.max ? "не подключён" : "подключён"}
                  </span>
                  {owner.needs.max && (
                    <button type="button" className="btn btn-small btn-primary" onClick={() => owner.link("max")}>
                      Подключить
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {bothConnected && <MessengerChoice />}
        </section>

        <section className="account-section" id="accountAlerts">
          <h3>Уведомления на этом устройстве</h3>
          <div className="account-alerts">
            <AlertSettings permission={alerts.permission} requestPermission={alerts.requestPermission} idPrefix="account" />
          </div>
          <p className="field-hint">
            В мессенджер приходит всегда: задачи и встречи на вас, ответы по вашим поручениям, а в понедельник и среду —
            сводка, если горит срок. Это не выключается: иначе поручение можно не увидеть вовсе.
          </p>
        </section>



        {desktopOffer && (
          <section className="account-section">
            <h3>Приложение для компьютера</h3>
            <p className="field-hint">
              Трекер в своём окне, с уведомлениями поверх других программ. Обновляется само. Windows может спросить «защитила
              ваш компьютер» — «Подробнее» → «Выполнить в любом случае».
            </p>
            <a className="btn btn-small btn-primary account-download" href="/api/download" id="accountDownload">
              <Icon name="download" size={14} /> Скачать для Windows
            </a>
          </section>
        )}

        {!!items.length && (
          <section className="account-section">
            <h3>Ещё</h3>
            <div className="account-items">
              {items.map((item) => (
                <button key={item.id} type="button" className="btn account-item" onClick={() => {
                    // Как пункт меню: окно уходит, действие идёт — своё окно
                    // вопроса или переход, которому кабинет поверх не нужен.
                    onClose();
                    item.onSelect();
                  }}>
                  <Icon name={item.icon} size={14} />
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="modal-actions account-actions">
          {/* «Везде» — для потерянного телефона или чужого компьютера, где
              забыли выйти: закрывает вход на всех устройствах сразу. */}
          <button type="button" className="btn" id="signOutEverywhereBtn" onClick={() => onSignOut(true)}>
            Выйти на всех устройствах
          </button>
          <button type="button" className="btn" id="accountSignOutBtn" onClick={() => onSignOut(false)}>
            <Icon name="logout" size={14} /> Выйти
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Куда писать — один мессенджер из двух (миграция 0070). 28.10.2026:
// «возможность выбрать только один бот, приоритетный конечно MAX, но и
// телеграмм должен быть доступен для выбора». До ответа сервера кнопок нет:
// показать MAX тому, кто выбрал Telegram, и через секунду переключить —
// это кнопка, которая сама двигается под рукой.
type Messenger = "max" | "telegram";

function MessengerChoice() {
  const [value, setValue] = useState<Messenger | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/account/messenger")
      .then((res) => res.json())
      .then((data: { messenger?: Messenger }) => alive && setValue(data.messenger === "telegram" ? "telegram" : "max"))
      .catch(() => alive && setValue("max"));
    return () => {
      alive = false;
    };
  }, []);

  async function choose(next: Messenger) {
    if (!value || next === value) return;
    const before = value;
    setValue(next);
    setError("");
    try {
      await postJson("/api/account/messenger", { messenger: next }, { fallback: "Не получилось сохранить выбор" });
    } catch (err) {
      setValue(before);
      setError(humanError(err, "Не получилось сохранить выбор"));
    }
  }

  if (!value) return null;
  return (
    <div className="account-ms-choice" id="messengerChoice">
      <span className="field-hint">Писать в</span>
      <ChipChoice<Messenger>
        value={value}
        options={[
          { value: "max", label: "MAX" },
          { value: "telegram", label: "Telegram" },
        ]}
        onSelect={(v) => void choose(v)}
      />
      {error && <div className="ms-link-error">{error}</div>}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}
