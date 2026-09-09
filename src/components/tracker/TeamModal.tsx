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
//
// Since the tracker became multi-user there is a third kind of invitation
// here, and it is not a messenger at all: a login. A manager who works at a
// computer wants the tracker itself; one who is always on the road wants
// Telegram; most want both. They are offered side by side because that is
// how the choice is actually made — per person, not per company.

const CHANNEL_LABEL: Record<ColleagueChannel, string> = { telegram: "Telegram", max: "MAX" };

type InviteKind = ColleagueChannel | "tracker";

const INVITE_LABEL: Record<InviteKind, string> = { telegram: "Telegram", max: "MAX", tracker: "трекер" };
const INVITE_LIFETIME: Record<InviteKind, string> = {
  telegram: "действует 15 минут",
  max: "действует 15 минут",
  tracker: "действует 7 дней",
};
const INVITE_HINT: Record<InviteKind, string> = {
  telegram: "Отправьте ссылку человеку — он откроет её и нажмёт «Start».",
  max: "Отправьте ссылку человеку — он откроет её и нажмёт «Start».",
  tracker: "Отправьте ссылку человеку — он придумает себе пароль и сразу окажется в трекере.",
};

const MEMBER_LABEL: Record<string, string> = {
  invited: "приглашён в трекер",
  active: "в трекере",
  disabled: "доступ отключён",
};

export default function TeamModal({ onClose }: { onClose: () => void }) {
  const { colleagues, loading, reload, invite, inviteToTracker, setDirection, setTrackerAccess, unlink } = useColleagues();
  const [inviteFor, setInviteFor] = useState<{ name: string; link: string; kind: InviteKind } | null>(null);
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
    setInviteFor({ name, link: result.link, kind: channel });
  }

  async function handleTrackerInvite(id: string, name: string, currentDirection = "") {
    setError("");
    // Направление спрашивается здесь, а не отдельным экраном: это
    // единственный момент, когда о человеке и так думают, и без него
    // понедельничная сводка по направлениям остаётся пустой колонкой.
    const direction = prompt(`Какое направление ведёт ${name}? (можно оставить пустым)`, currentDirection) ?? "";
    const result = await inviteToTracker(id, direction.trim());
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setCopied(false);
    setInviteFor({ name, link: result.link, kind: "tracker" });
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
        <h2>Команда</h2>

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

                  {/* Приглашение в сам трекер — отдельно от мессенджеров:
                      это логин, а не чат, и одно другого не заменяет. */}
                  {person.member === "none" && (
                    <button className="btn btn-small" onClick={() => handleTrackerInvite(person.id, person.name)}>
                      + В трекер
                    </button>
                  )}
                  {person.member === "invited" && (
                    <>
                      <span className="team-status">{MEMBER_LABEL.invited}</span>
                      <button className="btn btn-small" onClick={() => handleTrackerInvite(person.id, person.name, person.direction)}>
                        Ссылка ещё раз
                      </button>
                    </>
                  )}
                  {(person.member === "active" || person.member === "disabled") && (
                    <>
                      <span className={person.member === "active" ? "team-status linked" : "team-status"}>
                        {MEMBER_LABEL[person.member]}
                        {person.direction ? ` · ${person.direction}` : ""}
                      </span>
                      <button
                        className="btn btn-small"
                        type="button"
                        title="Направление"
                        onClick={() => {
                          const next = prompt(`Какое направление ведёт ${person.name}?`, person.direction);
                          if (next === null) return;
                          void setDirection(person.id, next.trim());
                        }}
                      >
                        Направление
                      </button>
                      <button
                        className="btn btn-small"
                        type="button"
                        onClick={() => {
                          const turnOff = person.member === "active";
                          if (
                            turnOff &&
                            !confirm(
                              `Отключить доступ ${person.name} в трекер? Задачи и его отчёты останутся на месте — исчезнет только вход.`,
                            )
                          )
                            return;
                          void setTrackerAccess(person.id, !turnOff);
                        }}
                      >
                        {person.member === "active" ? "Отключить вход" : "Вернуть вход"}
                      </button>
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
              Ссылка в {INVITE_LABEL[inviteFor.kind]} для {inviteFor.name} — {INVITE_LIFETIME[inviteFor.kind]}
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
            <div className="team-hint">{INVITE_HINT[inviteFor.kind]}</div>
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
