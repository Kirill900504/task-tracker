"use client";

import { useRef, useState } from "react";
import AttachFiles from "./AttachFiles";

// Ответ исполнителя — формой в карточке, а не системным окном браузера.
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

export default function AnswerForm({
  id,
  question,
  placeholder,
  emptyHint,
  submitLabel,
  date,
  withFiles = true,
  quick,
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
  // Можно ли приложить документы. По умолчанию — да, у любого ответа
  // (06.10.2026: «возможность вложить документ должна быть при любом
  // описании завершения задачи, встрече, переносе и так далее»). Раньше
  // кнопка была только у отчёта, а у отказа и переноса считалось, что
  // прикладывать нечего, — но письмо поставщика к отказу и справка к
  // переносу и есть причина. Куда кладутся файлы — решает тот, кто
  // получает onSubmit (отчёт — в done_files, остальное — lib/answerFiles).
  withFiles?: boolean;
  // Готовые ответы кнопками над полем (п.7.1 предложений, 07.10.2026):
  // на телефоне набирать «готово, проверьте» — это то, из-за чего
  // отвечают в мессенджере словами, мимо трекера. Нажатие ВСТАВЛЯЕТ фразу
  // в поле, а не отправляет: комментарий остаётся обязательным и своим —
  // его можно дописать, а случайное касание ничего не отправит.
  quick?: string[];
  busy?: boolean;
  onSubmit: (text: string, date: string, files: File[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [when, setWhen] = useState(date?.initial || "");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const field = useRef<HTMLTextAreaElement | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    send();
  }

  function send() {
    if (!text.trim()) {
      setError(emptyHint);
      return;
    }
    setError("");
    onSubmit(text.trim(), when, files);
  }

  return (
    <form className="ms-answer" onSubmit={submit}>
      <label className="ms-answer-q" htmlFor={id}>
        {question}
      </label>
      {quick && quick.length > 0 && (
        <div className="ms-answer-quick">
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              className="participant-chip"
              disabled={busy}
              onClick={() => {
                setText(q);
                setError("");
                field.current?.focus();
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={field}
        id={id}
        className="ms-answer-text"
        rows={3}
        autoFocus
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        // Enter отправляет отчёт, Shift+Enter переносит строку — одно
        // правило на все поля трекера, где пишут результат (см. Ask.tsx и
        // обсуждение). Отчёт почти всегда одна фраза, и нажатие Enter в
        // конце неё — то, что рука делает сама.
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!busy) send();
          }
        }}
      />
      {date && (
        <div className="ms-answer-date">
          <label htmlFor={id + "-date"}>{date.label}</label>
          <input id={id + "-date"} type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
      )}
      {withFiles && <AttachFiles files={files} onChange={setFiles} onError={setError} />}
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
