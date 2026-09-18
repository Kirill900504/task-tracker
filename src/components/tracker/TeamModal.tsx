"use client";

import { Fragment, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useColleagues, type ColleagueChannel } from "@/hooks/useColleagues";
import { useMaxBot } from "@/hooks/useMaxBot";
import { useAsk } from "@/components/Ask";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

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
//
// The link and the error appear UNDER THE ROW that was pressed, not at the
// bottom of the modal. With fourteen people the bottom of this list is a
// screen and a half below the button, so a link put there was produced,
// shown, and never seen: «не даёт ссылку ещё раз» was this and nothing else.

const CHANNEL_LABEL: Record<ColleagueChannel, string> = { telegram: "Telegram", max: "MAX" };

type InviteKind = ColleagueChannel | "tracker";

const INVITE_LABEL: Record<InviteKind, string> = { telegram: "Telegram", max: "MAX", tracker: "трекер" };
const INVITE_LIFETIME: Record<InviteKind, string> = {
  telegram: "действует 3 дня",
  max: "действует 3 дня",
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
  const maxBot = useMaxBot();
  const ask = useAsk();
  const [inviteFor, setInviteFor] = useState<{ id: string; name: string; link: string; kind: InviteKind } | null>(null);
  // Ошибка тоже привязана к человеку: «слишком много приглашений подряд»
  // внизу общего списка читается как поломка всего экрана, а не как ответ
  // на кнопку, которую только что нажали.
  const [error, setError] = useState<{ id: string; text: string } | null>(null);

  const [copied, setCopied] = useState(false);

  // Esc закрывает — как и любое другое окно трекера. Раньше не закрывал:
  // обработчик каждое окно заводило себе само, и это его не завело.
  useEscapeToClose(onClose);

  // Ссылка стоит прямо под строкой, но сама строка может оказаться у нижнего
  // края окна — тогда её всё равно не видно. Ref стабилен, поэтому прокрутка
  // случается ровно при появлении блока у нового человека, а не на каждой
  // перерисовке («Скопировать» ничего не дёргает).
  const revealInvite = useCallback((el: HTMLDivElement | null) => {
    el?.scrollIntoView({ block: "nearest" });
  }, []);

  async function handleInvite(id: string, name: string, channel: ColleagueChannel) {
    setError(null);
    const result = await invite(id, channel);
    if ("error" in result) {
      setError({ id, text: result.error });
      return;
    }
    setCopied(false);
    setInviteFor({ id, name, link: result.link, kind: channel });
  }

  async function handleTrackerInvite(id: string, name: string, currentDirection = "") {
    setError(null);
    // Направление спрашивается здесь, а не отдельным экраном: это
    // единственный момент, когда о человеке и так думают, и без него
    // понедельничная сводка по направлениям остаётся пустой колонкой.
    const direction =
      (await ask.ask({
        title: "Приглашение в трекер",
        question: `Какое направление ведёт ${name}?`,
        note: "Можно оставить пустым. По направлениям собирается понедельничная сводка.",
        value: currentDirection,
        placeholder: "Например: Продажи",
        okText: "Дать ссылку",
      })) ?? "";
    const result = await inviteToTracker(id, direction.trim());
    if ("error" in result) {
      setError({ id, text: result.error });
      return;
    }
    setCopied(false);
    setInviteFor({ id, name, link: result.link, kind: "tracker" });
  }

  async function copyLink() {
    if (!inviteFor) return;
    try {
      await navigator.clipboard.writeText(inviteFor.link);
      setCopied(true);
    } catch {
      setError({ id: inviteFor.id, text: "Скопируйте ссылку вручную — браузер не дал доступ к буферу обмена" });
    }
  }

  async function handleUnlink(id: string, name: string, channel: ColleagueChannel) {
    const yes = await ask.confirm({
      question: `Отключить ${name} от ${CHANNEL_LABEL[channel]}?`,
      note: "Задачи и встречи перестанут приходить туда.",
      okText: "Отключить",
      danger: true,
    });
    if (!yes) return;
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
                <Fragment key={person.id}>
                  {/* Строка человека — сетка из трёх ячеек, а не общий ряд,
                      в который свалены все кнопки подряд.
                      Раньше имя, состояние мессенджера, кнопки мессенджера,
                      состояние доступа и кнопки доступа были соседями в одном
                      flex-wrap: как только строка переставала помещаться — а
                      она перестаёт на каждом втором человеке, — перенос рвал
                      её в произвольном месте, и кнопки вставали то под
                      именем, то посреди чужой подписи. У четырнадцати человек
                      подряд это и выглядело «кнопки гуляют как хотят».
                      Теперь мессенджер и доступ — две отдельные ячейки: они
                      переносятся целиком и всегда остаются рядом со своей
                      подписью. */}
                  <div className="team-row">
                    <span className="team-name">{person.name}</span>
                    <div className="team-cell">
                    {person.linked ? (
                      <>
                        <span className="team-status linked">
                          {where}
                          {person.username ? ` · @${person.username}` : ""}
                        </span>
                        {/* Приглашение во второй мессенджер — для тех, кто уже
                            на связи в одном: запасной канал, не дубль. */}
                        {maxBot.available && !person.max && (
                          <button className="btn btn-small" onClick={() => handleInvite(person.id, person.name, "max")}>
                            + MAX
                          </button>
                        )}
                        {!person.telegram && (
                          <button className="btn btn-small" onClick={() => handleInvite(person.id, person.name, "telegram")}>
                            + Telegram
                          </button>
                        )}
                        <button
                          className="btn btn-small"
                          onClick={() => handleUnlink(person.id, person.name, person.telegram ? "telegram" : "max")}
                        >
                          Отключить
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="team-status">не подключён</span>
                        <button className="btn btn-small btn-primary" onClick={() => handleInvite(person.id, person.name, "telegram")}>
                          Telegram
                        </button>
                        {maxBot.available && (
                          <button className="btn btn-small btn-primary" onClick={() => handleInvite(person.id, person.name, "max")}>
                            MAX
                          </button>
                        )}
                      </>
                    )}
                    </div>

                    {/* Приглашение в сам трекер — отдельно от мессенджеров:
                        это логин, а не чат, и одно другого не заменяет. */}
                    <div className="team-cell">
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
                          onClick={() =>
                            void (async () => {
                              const next = await ask.ask({
                                title: "Направление",
                                question: `Какое направление ведёт ${person.name}?`,
                                note: "По направлениям собирается понедельничная сводка.",
                                value: person.direction,
                                placeholder: "Например: Продажи",
                                okText: "Сохранить",
                              });
                              if (next === null) return;
                              await setDirection(person.id, next.trim());
                            })()
                          }
                        >
                          Направление
                        </button>
                        <button
                          className="btn btn-small"
                          type="button"
                          onClick={() =>
                            void (async () => {
                              const turnOff = person.member === "active";
                              if (turnOff) {
                                const yes = await ask.confirm({
                                  question: `Отключить доступ ${person.name} в трекер?`,
                                  note: "Задачи и его отчёты останутся на месте — исчезнет только вход.",
                                  okText: "Отключить вход",
                                  danger: true,
                                });
                                if (!yes) return;
                              }
                              await setTrackerAccess(person.id, !turnOff);
                            })()
                          }
                        >
                          {person.member === "active" ? "Отключить вход" : "Вернуть вход"}
                        </button>
                      </>
                    )}
                    </div>
                  </div>

                  {inviteFor?.id === person.id && (
                    <div className="team-invite" id="inviteBlock" ref={revealInvite}>
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
                        <button className="btn btn-small" onClick={() => setInviteFor(null)}>
                          Скрыть
                        </button>
                      </div>
                      <div className="team-hint">{INVITE_HINT[inviteFor.kind]}</div>
                    </div>
                  )}

                  {error?.id === person.id && <div className="team-error team-error-row">{error.text}</div>}
                </Fragment>
              );
            })}
          </div>
        )}

        {!maxBot.available && (
          <div className="team-hint" style={{ marginTop: 12 }}>
            Бот в MAX не подключён — кнопок «MAX» поэтому нет.{" "}
            <a className="auth-link" style={{ padding: 0 }} href="/max">
              Подключить
            </a>
          </div>
        )}

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
