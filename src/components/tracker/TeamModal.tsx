"use client";

import { Fragment, useCallback, useState } from "react";
import { useColleagues, type Colleague, type ColleagueChannel } from "@/hooks/useColleagues";
import { MEMBER_ROLE_LABELS, type MemberRole } from "@/hooks/useWorkspaceRole";
import { useMaxBot } from "@/hooks/useMaxBot";
import { useAsk } from "@/components/Ask";
import ActionMenu, { type ActionMenuItem } from "./ActionMenu";
import Modal from "./Modal";
import { withoutSelfMark } from "@/lib/actorName";

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

// Четвёртый вид — «access» — не приглашение: он для того, кто в трекере уже
// есть, а ссылку или пароль потерял. Приглашение ему выдать нельзя (оно
// завело бы второй аккаунт мимо его же задач), и до появления этой кнопки
// строка «в трекере» была тупиком: ни ссылки, ни даже почты, под которой
// человек записан, нигде не видно.
type InviteKind = ColleagueChannel | "tracker" | "access";

const INVITE_LABEL: Record<InviteKind, string> = { telegram: "Telegram", max: "MAX", tracker: "трекер", access: "трекер" };
const INVITE_LIFETIME: Record<InviteKind, string> = {
  telegram: "действует 3 дня",
  max: "действует 3 дня",
  tracker: "действует 7 дней",
  access: "действует час",
};
const INVITE_HINT: Record<InviteKind, string> = {
  telegram: "Отправьте ссылку человеку — он откроет её и нажмёт «Start».",
  max: "Отправьте ссылку человеку — он откроет её и нажмёт «Start».",
  tracker: "Отправьте ссылку человеку — он придумает себе пароль и сразу окажется в трекере.",
  // Предупреждение не из вежливости: открытая у себя ссылка заменит вашу
  // сессию на его — вы окажетесь в трекере под чужим именем и решите, что
  // сломался трекер.
  access:
    "Отправьте ссылку человеку — он задаст новый пароль и войдёт под этой же почтой. Аккаунт и все его задачи остаются прежними. Сами её не открывайте: она входит в трекер за него.",
};

const MEMBER_LABEL: Record<string, string> = {
  invited: "приглашён в трекер",
  active: "в трекере",
  disabled: "доступ отключён",
};

export default function TeamModal({ onClose }: { onClose: () => void }) {
  const { colleagues, loading, reload, invite, inviteToTracker, accessLink, setDirection, setMemberRole, setTrackerAccess, unlink, rename } =
    useColleagues();
  const maxBot = useMaxBot();
  const ask = useAsk();
  const [inviteFor, setInviteFor] = useState<{
    id: string;
    name: string;
    link: string;
    kind: InviteKind;
    // Только у «access»: почта, под которой человек входит. Без неё ссылка
    // на новый пароль — половина ответа, а больше эту почту взять негде.
    email?: string;
  } | null>(null);
  // Ошибка тоже привязана к человеку: «слишком много приглашений подряд»
  // внизу общего списка читается как поломка всего экрана, а не как ответ
  // на кнопку, которую только что нажали.
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  // Открытое меню ⋮: чьё оно и от какой кнопки висит.
  const [menuFor, setMenuFor] = useState<{ id: string; name: string; anchor: DOMRect } | null>(null);

  const [copied, setCopied] = useState(false);

  // Esc закрывает — как и любое другое окно трекера. Раньше не закрывал:
  // обработчик каждое окно заводило себе само, и это его не завело.

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

  // Человек уже в трекере, но ссылку потерял или забыл пароль. Направление
  // здесь не спрашивается: оно уже задано, и вопрос посреди «мне надо
  // вернуть человеку вход» — лишний шаг там, где и так авария.
  async function handleAccessLink(id: string, name: string) {
    setError(null);
    const result = await accessLink(id);
    if ("error" in result) {
      setError({ id, text: result.error });
      return;
    }
    setCopied(false);
    setInviteFor({ id, name, link: result.link, kind: "access", email: result.email });
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

  async function handleDirection(person: Colleague) {
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
  }

  async function handleRename(person: Colleague) {
    // Пометка «(я)» из поля убрана и обратно её ставит сервер: это часть
    // имени СТРОКИ владельца, по которой трекер узнаёт её среди прочих, а
    // не часть имени человека. Править её руками незачем и опасно.
    const shown = withoutSelfMark(person.name);
    const next = await ask.ask({
      title: "Имя",
      question: person.isMe ? "Как вас видят остальные?" : `Как записать: ${shown}?`,
      note: "Это имя стоит в карточках задач, в составе встреч и в сообщениях бота — оно изменится везде сразу.",
      value: shown,
      placeholder: "Фамилия и имя",
      okText: "Сохранить",
    });
    if (next === null) return;
    if (!next.trim()) return;
    setError(null);
    const problem = await rename(person.id, next.trim());
    // Ответ — у той строки, к которой он относится: список длинный, и
    // сообщение внизу экрана к нажатой кнопке не относится ничем.
    if (problem) setError({ id: person.id, text: problem });
  }

  async function handleRole(person: Colleague) {
    const next = await ask.choose({
      title: "Права",
      question: `Что может ${person.name}?`,
      note: "Руководитель ведёт свою работу. Администратор и разработчик вдобавок меняют разделы и ответственных за них. «Команда», приглашения и сами права остаются у вас при любой роли.",
      options: [
        { value: "manager", label: "Руководитель" },
        { value: "admin", label: "Администратор" },
        { value: "developer", label: "Разработчик" },
      ],
    });
    if (next === null || next === person.role) return;
    await setMemberRole(person.id, next as MemberRole);
  }

  async function handleAccessToggle(person: Colleague) {
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
  }

  // Что у человека можно сделать помимо «позвать туда, где его ещё нет».
  //
  // Список собирается по состоянию, а не рисуется весь: пункт, ведущий к
  // отказу, хуже отсутствующего (то же правило, что у кнопок бота). Права
  // спрашиваются только у того, кто уже вошёл, — роль без входа ничего не
  // значит, разделы меняют из трекера.
  function menuItemsFor(person: Colleague): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];

    // Первым — имя. Оно есть у каждой строки, включая свою, и до сих пор
    // не менялось ниоткуда: опечатка, «Юра» вместо «Юрия», недостающая
    // фамилия оставались навсегда. А имя видят все: по нему выбирают,
    // кому поручить, и им же подписаны карточки и сообщения бота.
    items.push({ id: "rename", label: "Имя", onSelect: () => void handleRename(person) });

    // Своя строка на этом и заканчивается: приглашать себя некуда, вход у
    // владельца есть, а мессенджер он подключает кнопкой в шапке — та
    // привязывает чат к учётной записи, а не к строке (см. lib/reach).
    if (person.isMe) return items;

    // Второй мессенджер — запасной канал для того, кто уже на связи в
    // одном, а не копия: что уходит, уходит в один из них (chatsFor).
    if (person.linked && !person.telegram) {
      items.push({ id: "add-tg", label: "Позвать в Telegram", onSelect: () => void handleInvite(person.id, person.name, "telegram") });
    }
    if (person.linked && maxBot.available && !person.max) {
      items.push({ id: "add-max", label: "Позвать в MAX", onSelect: () => void handleInvite(person.id, person.name, "max") });
    }
    if (person.member === "invited") {
      items.push({
        id: "invite-again",
        label: "Ссылка в трекер ещё раз",
        onSelect: () => void handleTrackerInvite(person.id, person.name, person.direction),
      });
    }
    if (person.member === "active" || person.member === "disabled") {
      items.push({ id: "direction", label: "Направление", onSelect: () => void handleDirection(person) });
      if (person.member === "active") {
        items.push({ id: "role", label: "Права", onSelect: () => void handleRole(person) });
      }
      // Та же подпись, что у приглашённого: вопрос у Кирилла один — «дать
      // ссылку ещё раз», — а то, что внутри это другой маршрут (аккаунт уже
      // есть, заводить второй нельзя), его не касается.
      items.push({ id: "access-link", label: "Ссылка на новый пароль", onSelect: () => void handleAccessLink(person.id, person.name) });
      items.push({
        id: "access",
        label: person.member === "active" ? "Отключить вход" : "Вернуть вход",
        onSelect: () => void handleAccessToggle(person),
      });
    }
    if (person.linked && (person.telegram || person.max)) {
      items.push({
        id: "unlink",
        label: `Отключить от ${person.telegram ? "Telegram" : "MAX"}`,
        onSelect: () => void handleUnlink(person.id, person.name, person.telegram ? "telegram" : "max"),
      });
    }
    return items;
  }

  return (
    <Modal id="teamOverlay" onClose={onClose} dismissOnBackdrop={false}>
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
                  {/* Строка человека — сетка из трёх мест: имя, состояние,
                      действия. Раньше состояний и наборов кнопок было два
                      (мессенджер и доступ), и они стояли рядом: у того, кто
                      уже и в мессенджере, и в трекере, строка занимала ТРИ
                      яруса — «Telegram» и «MAX» разъезжались по разным
                      строкам, четыре кнопки доступа вставали в два ряда, а
                      подписи отрывались от своих кнопок. При четырнадцати
                      людях это тот же «кнопки гуляют как хотят», от которого
                      сетку и заводили: места в 580 пикселях окна на шесть
                      кнопок нет и не будет.
                      Поэтому в строке осталось только то, чего у человека
                      ЕЩЁ НЕТ (позвать в мессенджер, позвать в трекер), а всё
                      остальное — направление, права, повторная ссылка,
                      отключение входа и отвязка мессенджера — живёт в меню
                      по ⋮, как у карточки задачи. Ни одно действие не
                      пропало: они делаются раз в квартал, а место занимали в
                      каждой строке. */}
                  <div className="team-row">
                    {/* Имя без пометки «(я)»: она часть строки в базе, а не
                        часть имени, и на этом экране отвечает на вопрос
                        «как меня видят остальные» — то есть должна быть
                        показана ровно так, как её видят они. */}
                    <span className="team-name">{withoutSelfMark(person.name)}</span>

                    {/* Одно состояние на человека, а не два рядом: сначала
                        где он на связи, потом что у него с трекером. */}
                    <span className="team-status">
                      {/* Своя строка — это вы, и приглашать себя некуда:
                          мессенджер у владельца привязан к учётной записи
                          (кнопки в шапке), а вход у него и так есть. */}
                      <span className={person.isMe ? "linked" : person.linked ? "linked" : ""}>
                        {person.isMe
                          ? "это вы — так вас видят остальные"
                          : person.linked
                            ? where + (person.username ? ` · @${person.username}` : "")
                            : "не подключён"}
                      </span>
                      {person.member !== "none" && (
                        <>
                          {" · "}
                          <span className={person.member === "active" ? "linked" : ""}>
                            {MEMBER_LABEL[person.member]}
                            {person.direction ? ` · ${person.direction}` : ""}
                            {/* Роль называется только тогда, когда она не
                                обычная: у тринадцати из четырнадцати строк
                                слово «руководитель» повторялось бы, ничего
                                не добавляя. */}
                            {person.member === "active" && person.role !== "manager"
                              ? ` · ${MEMBER_ROLE_LABELS[person.role].toLowerCase()}`
                              : ""}
                          </span>
                        </>
                      )}
                    </span>

                    <div className="team-cell">
                      {/* Позвать туда, где человека ещё нет. Это и есть то,
                          ради чего окно открывают в первый раз. */}
                      {!person.isMe && !person.linked && (
                        <button className="btn btn-small btn-primary" onClick={() => handleInvite(person.id, person.name, "telegram")}>
                          Telegram
                        </button>
                      )}
                      {!person.isMe && !person.linked && maxBot.available && (
                        <button className="btn btn-small btn-primary" onClick={() => handleInvite(person.id, person.name, "max")}>
                          MAX
                        </button>
                      )}
                      {!person.isMe && person.member === "none" && (
                        <button className="btn btn-small" onClick={() => handleTrackerInvite(person.id, person.name)}>
                          + В трекер
                        </button>
                      )}
                      {!!menuItemsFor(person).length && (
                        <button
                          className="team-more"
                          type="button"
                          title="Ещё действия"
                          aria-label={`Ещё действия: ${person.name}`}
                          onClick={(e) => setMenuFor({ id: person.id, name: person.name, anchor: e.currentTarget.getBoundingClientRect() })}
                        >
                          ⋮
                        </button>
                      )}
                    </div>
                  </div>

                  {inviteFor?.id === person.id && (
                    <div className="team-invite" id="inviteBlock" ref={revealInvite}>
                      <label>
                        {inviteFor.kind === "access"
                          ? `Новый пароль для ${inviteFor.name} — ${INVITE_LIFETIME.access}`
                          : `Ссылка в ${INVITE_LABEL[inviteFor.kind]} для ${inviteFor.name} — ${INVITE_LIFETIME[inviteFor.kind]}`}
                      </label>
                      {/* Почта здесь единственный раз за весь трекер: войти
                          без неё нельзя, а спросить её больше не у кого. */}
                      {inviteFor.email && <div className="invite-link">Почта для входа: {inviteFor.email}</div>}
                      <div className="invite-link">{inviteFor.link}</div>
                      <div className="outcome-actions">
                        <button className="btn btn-small btn-primary" onClick={copyLink}>
                          {copied ? "Скопировано" : "Скопировать"}
                        </button>
                        {/* У «access» спрашивать нечего: человек и так в
                            трекере, меняется только его пароль. */}
                        {inviteFor.kind !== "access" && (
                          <button className="btn btn-small" onClick={() => void reload()}>
                            Проверить, подключился ли
                          </button>
                        )}
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

        {/* Меню висит на уровне окна, а не внутри строки: строки
            перерисовываются при каждом ответе сервера, а открытое меню
            переживать это должно. Пункты пересобираются по свежей строке —
            «Отключить вход» обязано стать «Вернуть вход» сразу. */}
        {menuFor &&
          (() => {
            const person = colleagues.find((p) => p.id === menuFor.id);
            const items = person ? menuItemsFor(person) : [];
            if (!items.length) return null;
            return (
              <ActionMenu
                anchor={menuFor.anchor}
                title={menuFor.name}
                items={items.map((item) => ({
                  ...item,
                  onSelect: () => {
                    setMenuFor(null);
                    item.onSelect();
                  },
                }))}
                onClose={() => setMenuFor(null)}
              />
            );
          })()}

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
    </Modal>
  );
}
