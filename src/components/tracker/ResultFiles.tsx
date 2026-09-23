"use client";

import { useEffect, useState } from "react";
import Icon from "./Icon";
import { signResultFiles } from "@/lib/resultFiles";

// Документы, приложенные к отчёту.
//
// Ссылку приходится спрашивать: корзина закрытая, постоянного адреса у файла
// нет по замыслу, и подписанная ссылка живёт час (см. lib/resultFiles). Пока
// она едет, файл уже назван — имя это правда, доступная сразу, а «Загрузка…»
// на его месте была бы словом вместо файла.
//
// Одной пачкой на все отчёты задачи: путей обычно один-три, и запрос на
// каждый превратил бы открытие карточки в очередь.

export type ResultFile = { path: string; name: string; size: number; type: string };

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function ResultFiles({ files }: { files: ResultFile[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Ключ, по которому эффект понимает, что список файлов действительно
  // другой: массив объектов каждый раз новый, и зависимость от него значила
  // бы запрос на каждую перерисовку карточки.
  const key = files.map((f) => f.path).join("|");

  useEffect(() => {
    let cancelled = false;
    if (!key) return;
    signResultFiles(key.split("|")).then((map) => {
      if (!cancelled) setUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!files.length) return null;

  return (
    <div className="result-files">
      {files.map((f) => {
        const url = urls[f.path];
        const image = f.type.startsWith("image/");
        return image && url ? (
          <a className="result-file image" key={f.path} href={url} target="_blank" rel="noreferrer" title={f.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={f.name} />
          </a>
        ) : (
          <a
            className="result-file"
            key={f.path}
            href={url || "#"}
            target="_blank"
            rel="noreferrer"
            title={url ? f.name : "Ссылка готовится…"}
            onClick={(e) => {
              if (!url) e.preventDefault();
            }}
          >
            <Icon name="clip" size={13} /> {f.name}
            <span className="result-file-size">{sizeLabel(f.size)}</span>
          </a>
        );
      })}
    </div>
  );
}
