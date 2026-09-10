"use client";

import { useRef, useState } from "react";
import { REACTIONS, useItemComments, type ItemKind } from "@/hooks/useItemComments";

// Обсуждение задачи там же, где задача.
//
// Everyone on the item reads the whole thread — no private branches. That is
// simpler to reason about and it is the point of having the conversation
// inside the task at all: a thread nobody can quietly split is a record,
// and a record is what stops «мы же договорились» from being one person's
// word against another's.
//
// Reactions are a fixed set of eight. An open picker looks generous and
// then does not survive the trip into a messenger, where a message is text
// and a reaction has to be rendered as a line under it.

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}, ${hh}:${mm}`;
}

const SOURCE_MARK: Record<string, string> = { telegram: " · из Telegram", max: " · из MAX", app: "" };

export default function ItemChat({ kind, itemId }: { kind: ItemKind; itemId: string }) {
  const { comments, loading, send, edit, remove, react } = useItemComments(kind, itemId);
  const [draft, setDraft] = useState("");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Выбранные, но ещё не отправленные файлы. Показываются списком до
  // отправки: «покажи, что сделал» чаще всего означает две фотографии, и
  // ошибиться файлом легко.
  const [pending, setPending] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleSend() {
    const text = draft.trim();
    if (!text && !pending.length) return;
    setBusy(true);
    setError("");
    try {
      await send(text, pending);
      setDraft("");
      setPending([]);
    } catch (e) {
      // Текст и файлы остаются на месте: повторить — это одно нажатие, а
      // набирать и прикладывать заново никто не станет.
      setError(e instanceof Error ? e.message : "Не отправилось. Проверьте связь и нажмите ещё раз.");
    }
    setBusy(false);
  }

  function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    const chosen = Array.from(list);
    // 20 МБ — предел корзины; сказать об этом здесь дешевле, чем дать
    // человеку дождаться отказа после загрузки.
    const tooBig = chosen.find((f) => f.size > 20 * 1024 * 1024);
    if (tooBig) {
      setError(`«${tooBig.name}» больше 20 МБ — такой файл не пройдёт.`);
      return;
    }
    setError("");
    setPending((prev) => [...prev, ...chosen]);
  }

  function sizeLabel(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  }

  function handleEdit(id: string, current: string) {
    const next = prompt("Изменить сообщение:", current);
    if (next === null) return;
    if (!next.trim()) {
      alert("Пустое сообщение — это удаление; нажмите «убрать».");
      return;
    }
    void edit(id, next);
  }

  function handleRemove(id: string) {
    if (!confirm("Убрать это сообщение из обсуждения?")) return;
    void remove(id);
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <span className="chat-title">Обсуждение</span>
        {comments.length > 0 && <span className="chat-count">{comments.length}</span>}
      </div>

      {loading && <div className="chat-empty">Загрузка…</div>}

      {!loading && comments.length === 0 && (
        <div className="chat-empty">
          Пока тихо. Здесь видно всё, что говорили по задаче, — и это видят все, кто на ней.
        </div>
      )}

      {comments.map((c) => (
        <div className={"chat-msg" + (c.mine ? " mine" : "")} key={c.id}>
          <div className="chat-msg-head">
            <span className="chat-author">{c.authorName}</span>
            <span className="chat-time">
              {timeLabel(c.createdAt)}
              {c.editedAt ? " · изменено" : ""}
              {SOURCE_MARK[c.source] || ""}
            </span>
          </div>
          {c.body && <div className="chat-body">{c.body}</div>}

          {c.attachments.length > 0 && (
            <div className="chat-files">
              {c.attachments.map((a) => (
                <a
                  key={a.path}
                  className={"chat-file" + (a.type.startsWith("image/") ? " image" : "")}
                  href={a.url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  title={a.name}
                >
                  {/* Фотографию показываем, остальное называем: акт и
                      выгрузку узнают по имени, а установленную кассу — нет.
                      eslint-disable-next-line @next/next/no-img-element */}
                  {a.type.startsWith("image/") && a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.name} />
                  ) : (
                    <span className="chat-file-name">📎 {a.name}</span>
                  )}
                </a>
              ))}
            </div>
          )}

          <div className="chat-foot">
            {c.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                className={"chat-reaction" + (r.mine ? " mine" : "")}
                title={r.mine ? "Убрать реакцию" : "Поддержать"}
                onClick={() => void react(c.id, r.emoji, !r.mine)}
              >
                {r.emoji} {r.count}
              </button>
            ))}
            <button
              type="button"
              className="chat-reaction chat-add"
              title="Поставить реакцию"
              onClick={() => setPickerFor(pickerFor === c.id ? null : c.id)}
            >
              ☺
            </button>
            {c.mine && (
              <>
                <button type="button" className="chat-mini" onClick={() => handleEdit(c.id, c.body)}>
                  изменить
                </button>
                <button type="button" className="chat-mini" onClick={() => handleRemove(c.id)}>
                  убрать
                </button>
              </>
            )}
          </div>

          {pickerFor === c.id && (
            <div className="chat-picker">
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="chat-pick"
                  onClick={() => {
                    const already = c.reactions.find((r) => r.emoji === emoji)?.mine || false;
                    void react(c.id, emoji, !already);
                    setPickerFor(null);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {error && <div className="chat-error">{error}</div>}

      {pending.length > 0 && (
        <div className="chat-pending">
          {pending.map((f, i) => (
            <span className="chat-pending-item" key={f.name + i}>
              📎 {f.name} <span className="chat-pending-size">{sizeLabel(f.size)}</span>
              <button
                type="button"
                className="chat-mini"
                onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}
              >
                убрать
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="chat-composer">
        <textarea
          value={draft}
          placeholder="Написать по задаче…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter отправляет, Shift+Enter переносит строку: сообщение в
            // обсуждении почти всегда одно предложение.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={2}
        />
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
        <button type="button" className="btn btn-small chat-clip" title="Приложить файл" onClick={() => fileInput.current?.click()}>
          📎
        </button>
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={busy || (!draft.trim() && !pending.length)}
          onClick={() => void handleSend()}
        >
          {busy ? "Отправляю…" : "Отправить"}
        </button>
      </div>
    </div>
  );
}
