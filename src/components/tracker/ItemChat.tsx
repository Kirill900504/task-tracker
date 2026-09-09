"use client";

import { useState } from "react";
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

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    await send(text);
    setBusy(false);
    setDraft("");
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
          <div className="chat-body">{c.body}</div>

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
        <button type="button" className="btn btn-small btn-primary" disabled={busy || !draft.trim()} onClick={() => void handleSend()}>
          Отправить
        </button>
      </div>
    </div>
  );
}
