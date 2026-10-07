"use client";

import { useEffect, useState } from "react";
import FileList from "./FileList";
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
//
// Как файл выглядит и открывается — FileList, общий с обсуждением.

export type ResultFile = { path: string; name: string; size: number; type: string };

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

  return <FileList className="result-files" files={files.map((f) => ({ ...f, url: urls[f.path] }))} />;
}
