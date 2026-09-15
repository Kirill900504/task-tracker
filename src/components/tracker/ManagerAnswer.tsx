"use client";

import { useState } from "react";

// Ответ руководителя — формой в карточке, а не системным окном браузера.
//
// Здесь стояли prompt() и alert(): девять штук на экран. На компьютере это
// просто некрасиво, а на телефоне — поломка. Экран руководителя открывают с
// телефона, и довольно часто из встроенного браузера самого мессенджера, где
// prompt либо не показывается вовсе, либо возвращает пустоту. Человек жмёт
// «Сделал», ничего не происходит — и он уверен, что отчитался, а постановщик
// уверен, что он молчит. Это худшее недоразумение, какое здесь возможно.
//
// Заодно уходит и то, чего prompt не умел: видно, о какой задаче речь, текст
// не пропадает при опечатке, и на телефоне открывается обычная клавиатура, а
// не модальное окно поверх всего.

export default function ManagerAnswer({
  id,
  question,
  placeholder,
  emptyHint,
  submitLabel,
  date,
  busy,
  onSubmit,
  onCancel,
}: {
  // Свой id на каждое поле: платформа переносит значения и фокус между
  // перерисовками, и два поля с одинаковым id этому мешают.
  id: string;
  question: string;
  placeholder?: string;
  // Что сказать, если отправляют пустым. Правило одно на весь трекер —
  // отчёт без слов не отчёт, отказ без причины не отказ, — и формулировка
  // должна объяснять почему, а не ругаться.
  emptyHint: string;
  submitLabel: string;
  // Есть только у просьбы о переносе: дата, на которую просят.
  date?: { label: string; initial: string };
  busy?: boolean;
  onSubmit: (text: string, date: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [when, setWhen] = useState(date?.initial || "");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      setError(emptyHint);
      return;
    }
    setError("");
    onSubmit(text.trim(), when);
  }

  return (
    <form className="ms-answer" onSubmit={submit}>
      <label className="ms-answer-q" htmlFor={id}>
        {question}
      </label>
      <textarea
        id={id}
        className="ms-answer-text"
        rows={3}
        autoFocus
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
      />
      {date && (
        <div className="ms-answer-date">
          <label htmlFor={id + "-date"}>{date.label}</label>
          <input id={id + "-date"} type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
      )}
      {error && <div className="ms-answer-error">{error}</div>}
      <div className="ms-answer-actions">
        <button className="btn btn-small btn-primary" type="submit" disabled={busy}>
          {busy ? "Отправляю…" : submitLabel}
        </button>
        <button className="btn btn-small" type="button" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
      </div>
    </form>
  );
}
