"use client";

import { useEffect, useRef, useState } from "react";
import AutoGrowTextarea from "./AutoGrowTextarea";
import MicButton from "./MicButton";
import ExpandableText from "./ExpandableText";
import ResultFiles, { type ResultFile } from "./ResultFiles";
import Icon from "./Icon";
import { sizeLabel } from "./AttachFiles";
import { tooBigFile, uploadTaskFiles } from "@/lib/resultFiles";
import { humanError } from "@/lib/humanError";

// Описание заведённой задачи — своим блоком под сводкой, с документами.
//
// Слова Кирилла 13.10.2026: «заполненное „описание“ не отображается в
// задаче, сделай, чтобы отображалось отдельным визуально приятным блоком,
// как блок со статусом, постановщиком и исполнителем. Блок описание должен
// быть с возможностью редактировать и дополнять, в том числе файлами…
// Блок описание должен находиться под блоком постановщик, исполнитель».
//
// До этого описание было голым абзацем НАД сводкой и пропадало вовсе, если
// пустое: смотрящий не мог отличить «описания нет» от «не загрузилось».
// Блок теперь есть всегда, и пустой говорит о себе словами.
//
// Правка — постановщика (у остальных блок только для чтения: база
// отказала бы молча, см. миграцию 0019). Сохраняется сама — Кирилл
// попросил убрать «Сохранить» из открытой задачи вовсе: текст пишется через
// секунду после последней буквы и при выходе из поля, файл — сразу после
// загрузки. Пишет синхронизация, как и всё в строке задачи.
//
// Почему правка описания здесь разрешена, хотя «заведённая задача — не
// черновик»: тот запрет был про НАЗВАНИЕ и смысл поручения, которые человек
// уже видел. Описание Кирилл назвал прямо — «редактировать и дополнять», —
// и дополнение (уточнение, приложенный макет) и есть его обычная жизнь.

export default function TaskDescription({
  taskId,
  desc,
  files,
  canEdit,
  onSave,
}: {
  taskId: string;
  desc: string;
  files: ResultFile[];
  canEdit: boolean;
  onSave: (desc: string, files: ResultFile[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(desc);
  const [uploading, setUploading] = useState<File[]>([]);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // Что сейчас записано — для отложенной записи и для выхода из окна:
  // замыкание таймера видело бы текст на момент его заведения.
  const latest = useRef({ draft: desc, files, saved: desc });
  useEffect(() => {
    latest.current.files = files;
  }, [files]);
  const timer = useRef<number | null>(null);

  function flush() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const text = latest.current.draft.trim();
    if (text === latest.current.saved.trim()) return;
    latest.current.saved = text;
    onSave(text, latest.current.files);
  }

  // Окно закрыли посреди правки (крестик, Esc) — набранное не теряется.
  useEffect(
    () => () => {
      flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function change(text: string) {
    setDraft(text);
    latest.current.draft = text;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 900);
  }

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    const chosen = Array.from(list);
    const big = tooBigFile(chosen);
    if (big) {
      setError(`«${big.name}» больше 20 МБ — такой файл не пройдёт.`);
      return;
    }
    setError("");
    setUploading(chosen);
    try {
      const uploaded = await uploadTaskFiles(taskId, chosen, "desc");
      const next = [...latest.current.files, ...uploaded];
      latest.current.files = next;
      latest.current.saved = latest.current.draft.trim();
      onSave(latest.current.draft.trim(), next);
    } catch (e) {
      setError(humanError(e, "Не получилось загрузить файл"));
    } finally {
      setUploading([]);
    }
  }

  function removeFile(path: string) {
    const next = latest.current.files.filter((f) => f.path !== path);
    latest.current.files = next;
    onSave(latest.current.draft.trim(), next);
  }

  const empty = !desc.trim() && !files.length;

  return (
    <div className={"desc-block" + (empty && !editing ? " empty" : "")} id="taskDesc">
      <div className="desc-head">
        <span className="fact-label">Описание</span>
        {canEdit && !editing && (
          <button type="button" className="desc-edit" id="editDescBtn" title="Изменить или дополнить описание" onClick={() => setEditing(true)}>
            <Icon name="edit" size={14} /> {empty ? "Добавить" : "Изменить"}
          </button>
        )}
        {canEdit && editing && (
          <button
            type="button"
            className="desc-edit"
            id="doneDescBtn"
            onClick={() => {
              flush();
              setEditing(false);
            }}
          >
            <Icon name="check" size={14} /> Готово
          </button>
        )}
      </div>

      {editing ? (
        <div className="input-with-mic">
          <AutoGrowTextarea
            id="taskDescEdit"
            value={draft}
            onChange={change}
            onBlur={flush}
            minRows={3}
            maxRows={12}
            placeholder="Детали, контекст, что считать результатом…"
            autoFocus
            focusAtEnd
          />
          <MicButton value={draft} onChange={change} title="Надиктовать описание" />
        </div>
      ) : desc.trim() ? (
        <ExpandableText text={desc} className="task-card-desc" />
      ) : (
        <div className="desc-empty">{canEdit ? "Описания нет — добавьте, что важно знать исполнителю." : "Описания нет."}</div>
      )}

      {files.length > 0 && <ResultFiles files={files} />}
      {canEdit && editing && files.length > 0 && (
        <div className="desc-files-edit">
          {files.map((f) => (
            <span className="ms-answer-file" key={f.path}>
              <Icon name="clip" size={13} /> {f.name} <span className="ms-answer-file-size">{sizeLabel(f.size)}</span>
              <button type="button" className="chat-mini" onClick={() => removeFile(f.path)}>
                Убрать
              </button>
            </span>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="desc-attach">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void pick(e.target.files);
              e.target.value = "";
            }}
          />
          <button type="button" className="btn btn-small" id="descAttachBtn" disabled={uploading.length > 0} onClick={() => fileInput.current?.click()}>
            <Icon name="clip" size={14} /> {uploading.length ? `Загружаю ${uploading.length}…` : "Приложить файл"}
          </button>
        </div>
      )}
      {error && <div className="ms-answer-error">{error}</div>}
    </div>
  );
}
