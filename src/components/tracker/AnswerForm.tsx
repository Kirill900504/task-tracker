"use client";

import { useRef, useState } from "react";
import Icon from "./Icon";
import { tooBigFile } from "@/lib/resultFiles";

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
  withFiles,
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
  // Можно ли приложить документы. Есть только у отчёта: «покажи, что
  // сделал» — это чаще всего акт или фотография, и Кирилл просил, чтобы
  // результат нёс их с собой, а не отсылал в обсуждение (см. миграцию
  // 0039). У отказа и просьбы о переносе прикладывать нечего.
  withFiles?: boolean;
  busy?: boolean;
  onSubmit: (text: string, date: string, files: File[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [when, setWhen] = useState(date?.initial || "");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

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

  function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    const chosen = Array.from(list);
    // 20 МБ — предел корзины, и сказать об этом надо ДО загрузки: иначе
    // человек ждёт отправки отчёта, а получает отказ на последнем байте.
    const tooBig = tooBigFile(chosen);
    if (tooBig) {
      setError(`«${tooBig.name}» больше 20 МБ — такой файл не пройдёт.`);
      return;
    }
    setError("");
    setFiles((prev) => [...prev, ...chosen]);
  }

  function sizeLabel(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
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
      {withFiles && (
        <div className="ms-answer-files">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              pickFiles(e.target.files);
              // Сброс, иначе один и тот же файл нельзя приложить второй раз.
              e.target.value = "";
            }}
          />
          <button type="button" className="btn btn-small" onClick={() => fileInput.current?.click()}>
            <Icon name="clip" size={14} /> Приложить документ
          </button>
          {files.map((f, i) => (
            <span className="ms-answer-file" key={f.name + i}>
              <Icon name="clip" size={13} /> {f.name} <span className="ms-answer-file-size">{sizeLabel(f.size)}</span>
              <button type="button" className="chat-mini" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                убрать
              </button>
            </span>
          ))}
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
