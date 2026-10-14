"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { MessengerState } from "@/hooks/useMyMessenger";
import type { ColleagueChannel } from "@/hooks/useColleagues";
import { emailProblem, passwordProblem } from "@/lib/workspaceInvite";
import { humanError } from "@/lib/humanError";
import Modal from "./Modal";
import Icon, { type IconName } from "./Icon";
import MessengerLink from "./MessengerLink";
import { MaxBrandIcon, TelegramBrandIcon } from "./MessengerBrandIcon";

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

export type AccountItem = { id: string; label: string; icon: IconName; onSelect: () => void };

export default function AccountModal({
  name,
  roleLabel,
  messenger,
  owner,
  items,
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
  onSignOut: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState<string | null>(null);
  const [draftEmail, setDraftEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/account/credentials")
      .then((res) => res.json())
      .then((data: { email?: string }) => {
        if (!alive) return;
        setEmail(data.email ?? "");
        setDraftEmail(data.email ?? "");
      })
      .catch(() => alive && setEmail(""));
    return () => {
      alive = false;
    };
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    const problem = emailProblem(draftEmail) || (password ? passwordProblem(password) : "");
    if (problem) return setNote({ ok: false, text: problem });
    if (!email && !password) return setNote({ ok: false, text: "Придумайте пароль — без него с компьютера не войти" });
    setBusy(true);
    try {
      const res = await fetch("/api/account/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: draftEmail, password }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; email?: string; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setNote({ ok: false, text: data?.error || "Не получилось сохранить" });
        return;
      }
      setEmail(data.email || draftEmail);
      setPassword("");
      setNote({ ok: true, text: password ? "Сохранено. С компьютера входите с этой почтой и паролем." : "Почта сохранена." });
    } catch (err) {
      setNote({ ok: false, text: humanError(err, "Не получилось сохранить") });
    } finally {
      setBusy(false);
    }
  }

  const changed = draftEmail.trim().toLowerCase() !== (email || "").toLowerCase() || !!password;

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
        </div>

        <section className="account-section">
          <h3>Вход с компьютера</h3>
          {email === null ? (
            <p className="field-hint">Загружаю…</p>
          ) : (
            <form onSubmit={save} className="account-form">
              <p className="field-hint">
                {email
                  ? "На компьютере вы входите с этой почтой и паролем. Пароль можно сменить здесь же."
                  : "Сейчас вы входите через мессенджер. Чтобы открывать трекер на компьютере, задайте почту и пароль."}
              </p>
              <label className="account-field">
                <span>Почта</span>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="ivanov@company.ru"
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                />
              </label>
              <label className="account-field">
                <span>{email ? "Новый пароль" : "Пароль"}</span>
                <span className="account-pass">
                  <input
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
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || !changed}>
                {busy ? "Сохраняю…" : "Сохранить"}
              </button>
            </form>
          )}
        </section>

        <section className="account-section">
          <h3>Мессенджеры</h3>
          <p className="field-hint">
            Туда приходят задачи и встречи с кнопками ответа, а в меню бота — «📱 Мобильное приложение»: весь трекер
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
        </section>

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

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onSignOut}>
            <Icon name="logout" size={14} /> Выйти
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}
