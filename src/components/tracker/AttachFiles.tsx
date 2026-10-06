"use client";

import { useRef } from "react";
import Icon from "./Icon";
import { tooBigFile } from "@/lib/resultFiles";

// «Приложить документ» — одна кнопка на все места, где пишут результат.
//
// Сначала она была только у отчёта (миграция 0039). 06.10.2026 Кирилл
// сказал прямо: «возможность вложить документ должна быть при любом
// описании завершения задачи, встрече, переносе и так далее». Отказ с
// письмом поставщика, перенос со справкой, итог встречи с протоколом,
// возврат на доработку с исправленным макетом — документ здесь и есть
// объяснение. Поэтому кнопка живёт здесь, а форма ответа (AnswerForm) и
// окно вопроса (Ask) её только ставят: две копии этой разметки разошлись
// бы на первой же правке.

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function AttachFiles({
  files,
  onChange,
  onError,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  // Пустая строка — снять прежнюю ошибку.
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  function pick(list: FileList | null) {
    if (!list?.length) return;
    const chosen = Array.from(list);
    // 20 МБ — предел корзины, и сказать об этом надо ДО загрузки: иначе
    // человек ждёт отправки, а получает отказ на последнем байте.
    const tooBig = tooBigFile(chosen);
    if (tooBig) {
      onError(`«${tooBig.name}» больше 20 МБ — такой файл не пройдёт.`);
      return;
    }
    onError("");
    onChange([...files, ...chosen]);
  }

  return (
    <div className="ms-answer-files">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          pick(e.target.files);
          // Сброс, иначе один и тот же файл нельзя приложить второй раз.
          e.target.value = "";
        }}
        // Пустое закрытие системного окна выбора шлёт `cancel`, и оно
        // всплывает до <dialog>. Окно вопроса от этого не закрывается
        // только потому, что Modal проверяет target === currentTarget, —
        // не убирайте ту проверку.
      />
      <button type="button" className="btn btn-small" onClick={() => input.current?.click()}>
        <Icon name="clip" size={14} /> Приложить документ
      </button>
      {files.map((f, i) => (
        <span className="ms-answer-file" key={f.name + i}>
          <Icon name="clip" size={13} /> {f.name} <span className="ms-answer-file-size">{sizeLabel(f.size)}</span>
          <button type="button" className="chat-mini" onClick={() => onChange(files.filter((_, j) => j !== i))}>
            убрать
          </button>
        </span>
      ))}
    </div>
  );
}
