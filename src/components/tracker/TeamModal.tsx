"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useColleagues } from "@/hooks/useColleagues";

// «Команда»: who can be written to in Telegram, and how to connect the rest.
//
// Connecting is a one-time step and it cannot be done from here alone —
// Telegram refuses to let a bot write to someone who has never opened it. So
// what this produces is a link to hand over; pressing Start on the other end
// is what actually attaches the chat to that name.
export default function TeamModal({ onClose }: { onClose: () => void }) {
  const { colleagues, loading, reload, invite, unlink } = useColleagues();
  const [inviteFor, setInviteFor] = useState<{ name: string; link: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleInvite(id: string, name: string) {
    setError("");
    const result = await invite(id);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setCopied(false);
    setInviteFor({ name, link: result.link });
  }

  async function copyLink() {
    if (!inviteFor) return;
    try {
      await navigator.clipboard.writeText(inviteFor.link);
      setCopied(true);
    } catch {
      setError("Скопируйте ссылку вручную — браузер не дал доступ к буферу обмена");
    }
  }

  async function handleUnlink(id: string, name: string) {
    if (!confirm(`Отключить ${name} от Telegram? Задачи и встречи перестанут ему приходить.`)) return;
    await unlink(id);
  }

  return createPortal(
    <div className="overlay open" id="teamOverlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Команда в Telegram</h2>

        {loading && <div className="empty">Загрузка…</div>}

        {!loading && colleagues.length === 0 && <div className="empty">Пока нет исполнителей — добавьте их в карточке задачи.</div>}

        {!loading && colleagues.length > 0 && (
          <div className="team-list" id="teamList">
            {colleagues.map((person) => (
              <div className="team-row" key={person.id}>
                <span className="team-name">{person.name}</span>
                {person.linked ? (
                  <>
                    <span className="team-status linked">на связи{person.username ? ` · @${person.username}` : ""}</span>
                    <button className="btn btn-small" onClick={() => handleUnlink(person.id, person.name)}>
                      Отключить
                    </button>
                  </>
                ) : (
                  <>
                    <span className="team-status">не подключён</span>
                    <button className="btn btn-small btn-primary" onClick={() => handleInvite(person.id, person.name)}>
                      Пригласить
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {inviteFor && (
          <div className="field" id="inviteBlock">
            <label>Ссылка для {inviteFor.name} — действует 15 минут</label>
            <div className="invite-link">{inviteFor.link}</div>
            <div className="outcome-actions">
              <button className="btn btn-small btn-primary" onClick={copyLink}>
                {copied ? "Скопировано" : "Скопировать"}
              </button>
              <button className="btn btn-small" onClick={() => void reload()}>
                Проверить, подключился ли
              </button>
            </div>
            <div className="team-hint">Отправьте ссылку человеку — он откроет её и нажмёт «Start».</div>
          </div>
        )}

        {error && <div className="team-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn" id="teamCloseBtn" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
