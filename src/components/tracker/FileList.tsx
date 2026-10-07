"use client";

import { useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import { sizeLabel } from "./AttachFiles";
import { useIsMobile } from "@/hooks/useIsMobile";

// Вложения — как в мессенджере: картинка миниатюрой, по нажатию — во весь
// экран поверх того, что открыто, а не новой вкладкой.
//
// Слова Кирилла 07.10.2026: «хочу чтобы картинки или файлы во вложении
// отображались уменьшенной версией, как в мессенджерах и открывались
// увеличением до полного формата прямо всплывающим окном в приложении».
// До этого фотография была ссылкой target=_blank: в установленном
// приложении и в окне на ПК это уводило из трекера в браузер, а вернуться
// можно было только вспомнив, откуда пришёл.
//
// Один компонент на ОБА места, где лежат файлы, — отчёт (ResultFiles) и
// обсуждение (ItemChat). Две копии одной разметки в этом проекте
// расходились каждый раз, а здесь разошлись бы ровно в том, что видно:
// в одном месте картинка открывалась бы окном, в другом — вкладкой.
//
// Картинка, которая не загрузилась, становится плашкой с именем, а не
// значком битой картинки: подписанная ссылка живёт час, файл мог быть не
// картинкой под именем .png — и в обоих случаях имя файла это правда, а
// битый значок — нет.

export type ShownFile = { path: string; name: string; size: number; type: string; url?: string };

// Что показывается окном. PDF — тоже, но только на компьютере: акт и счёт
// чаще всего именно он, и настольный браузер рисует его сам, а браузер
// телефона внутри окна PDF не рисует вовсе (Android показывает пустоту) —
// там он, как и таблицы с архивами, открывается отдельно.
function viewKind(f: ShownFile, mobile: boolean): "image" | "pdf" | null {
  if (f.type.startsWith("image/")) return "image";
  if (!mobile && (f.type === "application/pdf" || /\.pdf$/i.test(f.name))) return "pdf";
  return null;
}

export default function FileList({ files, className }: { files: ShownFile[]; className: string }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState<number | null>(null);
  // Пути картинок, которые не загрузились: им — плашка с именем.
  const [broken, setBroken] = useState<Record<string, true>>({});

  if (!files.length) return null;

  // Листать в окне можно только то, что окно умеет показать.
  const viewable = files.filter((f) => f.url && viewKind(f, mobile) && !broken[f.path]);
  const current = open === null ? null : viewable[open] || null;

  return (
    <div className={"file-list " + className}>
      {files.map((f) => {
        const kind = viewKind(f, mobile);
        const thumb = kind === "image" && f.url && !broken[f.path];
        const idx = viewable.indexOf(f);
        return (
          <a
            key={f.path}
            className={"file-item" + (thumb ? " image" : "")}
            href={f.url || "#"}
            target="_blank"
            rel="noreferrer"
            title={f.url ? f.name : "Ссылка готовится…"}
            onClick={(e) => {
              if (!f.url) return e.preventDefault();
              // Обычное нажатие — окно; Ctrl/⌘ и средняя кнопка по-прежнему
              // открывают вкладку: это жест «хочу отдельно», и отбирать его
              // незачем.
              if (idx >= 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
                e.preventDefault();
                setOpen(idx);
              }
            }}
          >
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={f.url}
                alt={f.name}
                loading="lazy"
                onError={() => setBroken((b) => ({ ...b, [f.path]: true }))}
              />
            ) : (
              <span className="file-item-name">
                <Icon name="clip" size={13} />
                <span className="file-item-text">{f.name}</span>
                {f.size > 0 && <span className="file-item-size">{sizeLabel(f.size)}</span>}
              </span>
            )}
          </a>
        );
      })}

      {/* Окно лежит в <body> порталом, но React проносит его события по
          дереву КОМПОНЕНТОВ — то есть через пузырь сообщения с его меню по
          долгому нажатию и через карточку, которую можно взять мышью.
          Обёртка останавливает их здесь. */}
      {current && open !== null && (
        <span
          className="file-viewer-host"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <FileViewer
            file={current}
            index={open}
            total={viewable.length}
            onStep={(d) => setOpen((i) => (i === null ? i : (i + d + viewable.length) % viewable.length))}
            onClose={() => setOpen(null)}
          />
        </span>
      )}
    </div>
  );
}

function FileViewer({
  file,
  index,
  total,
  onStep,
  onClose,
}: {
  file: ShownFile;
  index: number;
  total: number;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  // Сюда доходят только файлы, которые окно умеет показать (см. viewable),
  // так что «не картинка» здесь значит PDF.
  const kind = file.type.startsWith("image/") ? "image" : "pdf";
  return (
    // Своё окно поверх открытого: <dialog> кладётся в верхний слой ПОСЛЕ
    // карточки задачи, и Escape закрывает только его (Modal проверяет, что
    // `cancel` свой) — карточка под ним остаётся открытой.
    <Modal onClose={onClose} variant="viewer">
      <div
        className="viewer"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (total < 2) return;
          if (e.key === "ArrowRight") onStep(1);
          if (e.key === "ArrowLeft") onStep(-1);
        }}
        // Щелчок по пустому полю вокруг картинки закрывает, как в
        // мессенджере; по самой картинке — нет, её разглядывают.
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="viewer-bar">
          <span className="viewer-name" title={file.name}>
            {file.name}
            {total > 1 && <span className="viewer-count">{index + 1} из {total}</span>}
          </span>
          <a className="viewer-btn" href={file.url} download={file.name} target="_blank" rel="noreferrer" title="Скачать">
            <Icon name="download" size={18} />
          </a>
          <button type="button" className="viewer-btn" onClick={onClose} title="Закрыть (Esc)" aria-label="Закрыть">
            <Icon name="close" size={18} />
          </button>
        </div>

        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="viewer-image" src={file.url} alt={file.name} />
        ) : (
          <iframe className="viewer-frame" src={file.url} title={file.name} />
        )}

        {total > 1 && (
          <>
            <button type="button" className="viewer-nav prev" onClick={() => onStep(-1)} aria-label="Предыдущий">
              <Icon name="arrow-left" size={22} />
            </button>
            <button type="button" className="viewer-nav next" onClick={() => onStep(1)} aria-label="Следующий">
              <Icon name="arrow-right" size={22} />
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
