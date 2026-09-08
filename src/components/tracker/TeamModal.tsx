"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { MAX_AVAILABLE, useColleagues, type ColleagueChannel } from "@/hooks/useColleagues";

// «Команда»: who can be written to, and how to connect the rest.
//
// Connecting is a one-time step and it cannot be done from here alone —
// neither Telegram nor MAX will let a bot write to someone who has never
// opened it. So what this produces is a link to hand over; pressing Start on
// the other end is what actually attaches the chat to that name.
//
// A person can be connected to both messengers; what is sent goes to one of
// them (see chatsFor), so the second is a spare route rather than a copy.

const CHANNEL_LABEL: Record<ColleagueChannel, string> = { telegram: "Telegram", max: "MAX" };

export default function TeamModal({ onClose }: { onClose: () => void }) {
  const { colleagues, loading, reload, invite, unlink } = useColleagues();
  const [inviteFor, setInviteFor] = useState<{ name: string; link: string; channel: ColleagueChannel } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleInvite(id: string, name: string, channel: ColleagueChannel) {
    setError("");
    const result = await invite(id, channel);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setCopied(false);
    setInviteFor({ name, link: result.link, channel });
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

  async function handleUnlink(id: string, name: string, channel: ColleagueChannel) {
    if (!confirm(`Отключить ${name} от ${CHANNEL_LABEL[channel]}? Задачи и встречи перестанут приходить туда.`)) return;
    await unlink(id, channel);
  }

  return createPortal(
    <div className="overlay open" id="teamOverlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Команда в мессенджерах</h2>

        {loading && <div className="empty">Загрузка…</div>}

        {!loading && colleagues.length === 0 && <div className="empty">Пока нет исполнителей — добавьте их в карточке задачи.</div>}

        {!loading && colleagues.length > 0 && (
          <div className="team-list" id="teamList">
            {colleagues.map((person) => {
              const where = [person.telegram ? "Telegram" : "", person.max ? "MAX" : ""].filter(Boolean).join(" · ");
              return (
                <div className="team-row" key={person.id}>
                  <span className="team-name">{person.name}</span>
                  {person.linked ? (
                    <>
                      <span className="team-status linked">
                        {where}
                        {person.username ? ` · @${person.username}` : ""}
                      </span>
                      {/* Приглашение во второй мессенджер — для тех, кто уже
                          на связи в одном: запасной канал, не дубль. */}
                      {MAX_AVAILABLE && !person.max && (
                        <button className="btn btn-small" onClick={() => handleInvite(person.id, person.name, "max")}>
                          + MAX
                        </button>
                      )}
                      {!person.telegram && (
                        <button className="btn btn-small" onClick={() => handleInvite(person.id, person.name, "telegram")}>
                          + Telegram
                        </button>
                      )}
                      <button className="btn btn-small" onClick={() => handleUnlink(person.id, person.name, person.telegram ? "telegram" : "max")}>
                        Отключить
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="team-status">не подключён</span>
                      <button className="btn btn-small btn-primary" onClick={() => handleInvite(person.id, person.name, "telegram")}>
                        Telegram
                      </button>
                      {MAX_AVAILABLE && (
                        <button className="btn btn-small btn-primary" onClick={() => handleInvite(person.id, person.name, "max")}>
                          MAX
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {inviteFor && (
          <div className="field" id="inviteBlock">
            <label>
              Ссылка в {CHANNEL_LABEL[inviteFor.channel]} для {inviteFor.name} — действует 15 минут
            </label>
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
