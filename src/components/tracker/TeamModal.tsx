"use client";

import { Fragment, useCallback, useState } from "react";
import { loadArchived, useColleagues, type Colleague, type ColleagueChannel } from "@/hooks/useColleagues";
import ItemModalHead from "./ItemModalHead";
import Icon from "./Icon";
import { MEMBER_ROLE_LABELS, type MemberRole } from "@/hooks/useWorkspaceRole";
import { useMaxBot } from "@/hooks/useMaxBot";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useAsk } from "@/components/Ask";
import ActionMenu, { type ActionMenuItem } from "./ActionMenu";
import Modal from "./Modal";
import { MaxBrandIcon, TelegramBrandIcon } from "./MessengerBrandIcon";
import { withoutSelfMark } from "@/lib/actorName";
import { useAwayEditor } from "./AwayMenu";
import { awayPhrase, isAwayOn } from "@/lib/away";
import { todayStr } from "@/lib/taskDisplay";
import { phoneHref } from "@/lib/phone";

// «Команда»: who can be written to, and how to connect the rest.
//
// Connecting is a one-time step and it cannot be done from here alone —
// neither Telegram nor MAX will let a bot write to someone who has never
// opened it. So what this produces is a link to hand over; pressing Start on
// the other end is what actually attaches the chat to that name.
//
// С 28.10.2026 ссылка одна — приглашение «всё в одном» (lib/welcomeInvite):
// страница с именем человека, где он сам выбирает мессенджер, видит, как
// открыть трекер на телефоне, и скачивает приложение для компьютера, в
// котором входит тем же ботом без пароля (lib/messengerLogin). До этого в
// строке стояли три кнопки — «Telegram», «MAX», «+ В трекер», — и за
// каждой своя ссылка со своим сроком: Кирилл выбирал за человека, какой у
// того мессенджер, а вход по почте и паролю шёл отдельной дорогой. Вход по
// почте остался — в меню ⋮, для тех, кому он правда нужен.
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
type InviteKind = "welcome" | "tracker" | "access";

const INVITE_LIFETIME: Record<InviteKind, string> = {
  welcome: "действует 7 дней",
  tracker: "действует 7 дней",
  access: "действует час",
};
const INVITE_HINT: Record<InviteKind, string> = {
  welcome:
    "Отправьте в любом чате или почтой. По ссылке человек подключит бота, увидит, как открыть трекер на телефоне, и скачает приложение для компьютера — войдёт в нём через бота, без пароля.",
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

// Отбор над списком. Считается по тому, что Кириллу нужно СДЕЛАТЬ с
// людьми, а не по тому, чем они заняты: о чужой работе «Команда» не говорит
// ничего (см. «Загрузки нет» в CLAUDE.md) — только кто на связи, кто ещё нет
// и кого нет на месте.
type Filter = "all" | "off" | "on" | "away";

type BulkLine = { id: string; name: string; link?: string; message?: string; error?: string };

// «Поделиться» — системное окно отправки (на Windows в нём Telegram, почта,
// ближайшие устройства). Есть не везде, поэтому кнопка показывается только
// там, где оно есть, а копирование остаётся всегда.
const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

export default function TeamModal({ onClose }: { onClose: () => void }) {
  const {
    colleagues,
    loading,
    reload,
    welcome,
    inviteToTracker,
    accessLink,
    setDirection,
    setMemberRole,
    setTrackerAccess,
    unlink,
    rename,
    addPerson,
    previewRemoval,
    removePerson,
    restorePerson,
  } = useColleagues();
  const maxBot = useMaxBot();
  const isMobile = useIsMobile();
  const ask = useAsk();
  const editAway = useAwayEditor();
  const [inviteFor, setInviteFor] = useState<{
    id: string;
    name: string;
    link: string;
    kind: InviteKind;
    // Только у «welcome»: готовый текст для чата.
    message?: string;
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
  // Раскрытая карточка человека — всё о нём и все действия кнопками.
  const [openFor, setOpenFor] = useState<string | null>(null);
  // Рабочие почта и телефон из «Моих данных» людей — читаются при первом
  // раскрытии карточки, а не при открытии окна: нужны редко, а запрос
  // обходит учётные записи всех людей (/api/workspace/contacts).
  const [contacts, setContacts] = useState<Record<string, { phone: string; email: string }> | null>(null);

  function toggleCard(id: string) {
    const next = openFor === id ? null : id;
    setOpenFor(next);
    if (next && !contacts) {
      void fetch("/api/workspace/contacts")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { contacts?: Record<string, { phone: string; email: string }> } | null) => setContacts(data?.contacts || {}))
        .catch(() => setContacts({}));
    }
  }
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  // Что именно скопировано: «Скопировано» загорается у той кнопки, которую
  // нажали, а не у всех сразу.
  const [copied, setCopied] = useState("");

  // Только что добавленный человек: его строка подсвечена и прокручена в
  // видимую область — следующий шаг (позвать в мессенджер или в трекер)
  // стоит прямо в ней, и искать его в списке из пятнадцати незачем.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // Убрать человека с открытыми делами — это вопрос «кому передать», и он
  // задаётся под его строкой, а не окном поверх: ответ там, где кнопка.
  const [removing, setRemoving] = useState<{
    id: string;
    name: string;
    openTasks: number;
    openMeetings: number;
    sample: string[];
    to: string | null;
    busy: boolean;
  } | null>(null);
  // Убранные — список внизу, раскрывается по нажатию: нужен он редко.
  const [archived, setArchived] = useState<{ id: string; name: string; archivedAt: string }[] | null>(null);
  const [notice, setNotice] = useState("");

  // Ссылка стоит прямо под строкой, но сама строка может оказаться у нижнего
  // края окна — тогда её всё равно не видно. Ref стабилен, поэтому прокрутка
  // случается ровно при появлении блока у нового человека, а не на каждой
  // перерисовке («Скопировать» ничего не дёргает).
  const revealInvite = useCallback((el: HTMLDivElement | null) => {
    el?.scrollIntoView({ block: "nearest" });
  }, []);

  async function copy(text: string, key: string, errorId: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setError({ id: errorId, text: "Браузер не дал доступ к буферу обмена — выделите текст и скопируйте вручную" });
    }
  }

  async function share(text: string) {
    try {
      await navigator.share({ text });
    } catch {
      // Окно закрыли, ничего не выбрав, — это ответ, а не ошибка.
    }
  }

  async function handleWelcome(person: Colleague) {
    setError(null);
    const result = await welcome([person.id]);
    const one = "error" in result ? null : result.invites[0];
    if (!one?.link) {
      setError({ id: person.id, text: ("error" in result ? result.error : one?.error) || "Не получилось создать приглашение" });
      return;
    }
    setCopied("");
    setInviteFor({ id: person.id, name: withoutSelfMark(person.name), link: one.link, message: one.message, kind: "welcome" });
  }

  async function handleTrackerInvite(id: string, name: string, currentDirection = "") {
    setError(null);
    // Направление спрашивается здесь, а не отдельным экраном: это
    // единственный момент, когда о человеке и так думают.
    const direction =
      (await ask.ask({
        title: "Вход по почте и паролю",
        question: `Какое направление ведёт ${name}?`,
        note: "Можно оставить пустым. По ссылке человек задаст почту и пароль. Обычно это не нужно: приглашение даёт вход через бота, без пароля.",
        value: currentDirection,
        placeholder: "Например: Продажи",
        okText: "Дать ссылку",
      })) ?? "";
    const result = await inviteToTracker(id, direction.trim());
    if ("error" in result) {
      setError({ id, text: result.error });
      return;
    }
    setCopied("");
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
    setCopied("");
    if ("sentToChat" in result) {
      setNotice(`Ссылка на новый пароль ушла ${withoutSelfMark(name)} в мессенджер — в чат с ботом. Почта для входа: ${result.email}.`);
      return;
    }
    setInviteFor({ id, name, link: result.link, kind: "access", email: result.email });
  }

  // Приглашения всем неподключённым — одним нажатием (п.1.1 предложений,
  // 07.10.2026). Разослать за Кирилла трекер не может — у неподключённого нет
  // чата, в этом и дело, — поэтому он отдаёт готовые сообщения с именами:
  // каждое можно скопировать или «Поделиться» прямо в чат человеку. «Всё
  // разом — в общий чат» убрано (аудит 30.10.2026): ссылка и есть вход, по
  // ней подключается тот, кто откроет её первым, — в общем чате любой мог
  // стать любым. Неподключённый — без мессенджера: вход у
  // него может и быть, но задачи до него из бота не доходят.
  const unreached = colleagues.filter((p) => !p.isMe && !p.linked);
  const [bulk, setBulk] = useState<{ lines: BulkLine[]; busy: boolean } | null>(null);

  async function inviteAllUnreached() {
    setBulk({ lines: [], busy: true });
    setCopied("");
    const result = await welcome(unreached.map((p) => p.id));
    if ("error" in result) {
      setBulk(null);
      setError({ id: "bulk", text: result.error });
      return;
    }
    setBulk({ lines: result.invites, busy: false });
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
      note: "Подпись рядом с именем в «Команде».",
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

  async function handleAdd() {
    setError(null);
    setNotice("");
    const name = await ask.ask({
      title: "Новый человек",
      question: "Как его записать?",
      note: "Имя и фамилия — так человека увидят в карточках задач, во встречах и в сообщениях бота.",
      placeholder: "Имя Фамилия",
      okText: "Добавить",
    });
    if (!name?.trim()) return;
    const result = await addPerson(name.trim());
    if ("error" in result) {
      setError({ id: "add", text: result.error });
      return;
    }
    // Новый человек должен быть виден, каким бы ни был отбор.
    setFilter("all");
    setQuery("");
    setJustAdded(result.id);
    setNotice(
      result.restored
        ? `${name.trim()} снова в команде — вместе со всем, что делал раньше. Пригласите его — кнопка в его строке.`
        : `${name.trim()} добавлен. Пригласите его — кнопка «Пригласить» в его строке.`,
    );
  }

  // Убрать из команды. Сначала маршрут считает, что на человеке открыто:
  // пусто — хватит подтверждения; есть — под строкой встаёт вопрос «кому
  // передать», и без ответа убрать нельзя (открытая задача на ушедшем —
  // ровно та забытая работа, ради которой трекер существует).
  async function handleRemove(person: Colleague) {
    setError(null);
    setNotice("");
    setRemoving(null);
    const preview = await previewRemoval(person.id);
    if ("error" in preview) {
      setError({ id: person.id, text: preview.error });
      return;
    }
    const shown = withoutSelfMark(person.name);
    if (!preview.openTasks && !preview.openMeetings) {
      const yes = await ask.confirm({
        title: "Убрать из команды",
        question: `Убрать ${shown} из команды?`,
        note: "Открытых задач и встреч у него нет. Вход и мессенджер отключатся, а закрытые задачи сохранят его имя. Вернуть можно из списка «Убранные» внизу.",
        okText: "Убрать",
        danger: true,
      });
      if (!yes) return;
      await finishRemove(person.id, shown, null);
      return;
    }
    setRemoving({ id: person.id, name: shown, ...preview, to: null, busy: false });
  }

  async function finishRemove(id: string, name: string, to: string | null) {
    setRemoving((r) => (r ? { ...r, busy: true } : r));
    const receiver = to ? withoutSelfMark(colleagues.find((p) => p.id === to)?.name || "") : "";
    const result = await removePerson(id, to);
    if ("error" in result) {
      setRemoving((r) => (r ? { ...r, busy: false } : r));
      setError({ id, text: result.error });
      return;
    }
    setRemoving(null);
    setNotice(
      (receiver ? `${name} убран из команды, открытые дела переданы: ${receiver}.` : `${name} убран из команды.`) +
        (result.archived ? " Вернуть можно из списка «Убранные» внизу." : ""),
    );
    if (archived) setArchived(await loadArchived());
  }

  async function toggleArchived() {
    if (archived) {
      setArchived(null);
      return;
    }
    setArchived(await loadArchived());
  }

  async function handleRestore(id: string, name: string) {
    const problem = await restorePerson(id);
    if (problem) {
      setError({ id: "archived", text: problem });
      return;
    }
    setArchived(await loadArchived());
    setFilter("all");
    setJustAdded(id);
    setNotice(`${withoutSelfMark(name)} снова в команде. Вход и мессенджер подключаются заново — кнопка «Пригласить» в его строке.`);
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
  // значит, разделы меняют из трекера. Этот же список — кнопки в раскрытой
  // карточке человека: два места, одно правило.
  function menuItemsFor(person: Colleague): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];

    // Первым — имя. Оно есть у каждой строки, включая свою, и до сих пор
    // не менялось ниоткуда: опечатка, «Юра» вместо «Юрия», недостающая
    // фамилия оставались навсегда. А имя видят все: по нему выбирают,
    // кому поручить, и им же подписаны карточки и сообщения бота.
    items.push({ id: "rename", label: "Имя", onSelect: () => void handleRename(person) });
    // Отпуск, больничный, командировка (миграция 0047). Человек отмечает
    // себя сам из меню аккаунта, а здесь — тот случай, когда он слёг и до
    // трекера не добрался, а владелец уже знает.
    items.push({ id: "away", label: "Нет на месте…", onSelect: () => void editAway(person) });

    // Своя строка на этом и заканчивается: приглашать себя некуда, вход у
    // владельца есть, а мессенджер он подключает в личном кабинете — тот
    // привязывает чат к учётной записи, а не к строке (см. lib/reach).
    if (person.isMe) return items;

    // Приглашение — и тому, кто уже на связи: по той же странице он
    // подключит второй мессенджер про запас или скачает приложение для
    // компьютера. Что уходит, уходит в один из мессенджеров (chatsFor).
    items.push({ id: "welcome", label: person.linked ? "Приглашение ещё раз" : "Пригласить", onSelect: () => void handleWelcome(person) });
    if (person.member === "none") {
      items.push({ id: "tracker", label: "Вход по почте и паролю…", onSelect: () => void handleTrackerInvite(person.id, person.name) });
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
    if (person.telegram) {
      items.push({ id: "unlink-tg", label: "Отключить от Telegram", onSelect: () => void handleUnlink(person.id, person.name, "telegram") });
    }
    if (person.max) {
      items.push({ id: "unlink-max", label: "Отключить от MAX", onSelect: () => void handleUnlink(person.id, person.name, "max") });
    }
    // Последним — как «Удалить» у карточки задачи: самое тяжёлое действие
    // стоит дальше всех от руки.
    items.push({ id: "remove", label: "Убрать из команды…", icon: "trash", onSelect: () => void handleRemove(person) });
    return items;
  }

  const today = todayStr();
  const awayCount = colleagues.filter((p) => isAwayOn(p.awayUntil, today)).length;
  const onCount = colleagues.filter((p) => !p.isMe && p.linked).length;
  const q = query.trim().toLowerCase();
  const shown = colleagues.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (filter === "off") return !p.isMe && !p.linked;
    if (filter === "on") return !p.isMe && p.linked;
    if (filter === "away") return isAwayOn(p.awayUntil, today);
    return true;
  });
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "Все", count: colleagues.length },
    { id: "on", label: "На связи", count: onCount },
    { id: "off", label: "Не подключены", count: unreached.length },
    ...(awayCount ? [{ id: "away" as const, label: "Нет на месте", count: awayCount }] : []),
  ];

  return (
    <Modal id="teamOverlay" onClose={onClose} dismissOnBackdrop={false}>
      <div className="modal team-modal">
        <ItemModalHead
          plain
          title={
            <>
              Команда {!loading && <span className="count">{colleagues.length}</span>}
            </>
          }
          closeId="teamCloseBtn"
          onClose={onClose}
          actions={
            <button type="button" className="item-head-btn" id="addPersonBtn" onClick={() => void handleAdd()}>
              <Icon name="plus" size={14} /> Человек
            </button>
          }
        />
        {error?.id === "add" && <div className="team-error team-error-row">{error.text}</div>}
        {notice && (
          <div className="team-notice" id="teamNotice" role="status">
            {notice}
          </div>
        )}

        {/* Ответ — здесь же, под кнопкой (правило «ответ там, где кнопка»). */}
        {!loading && unreached.length > 0 && (
          <div className="team-bulk">
            <div className="team-bulk-row">
              <span>
                Не подключены: <b>{unreached.length}</b> — задачи до них не доходят.
              </span>
              <button className="btn btn-small btn-primary" id="inviteAllBtn" disabled={bulk?.busy} onClick={() => void inviteAllUnreached()}>
                {bulk?.busy ? "Готовлю приглашения…" : "Пригласить всех"}
              </button>
            </div>
            {error?.id === "bulk" && <div className="team-error">{error.text}</div>}
            {bulk && bulk.lines.length > 0 && (
              <div className="team-invite" id="bulkInviteBlock" ref={revealInvite}>
                <label>Приглашения — по одному на человека, действуют 7 дней</label>
                <div className="team-hint" id="bulkInviteWarning">
                  Каждую ссылку — лично этому человеку, не в общий чат: по ней входит в трекер тот, кто откроет её первым.
                </div>
                <div className="team-bulk-links">
                  {bulk.lines.map((l) =>
                    l.error || !l.link ? (
                      <div key={l.id} className="team-error">
                        {l.name}: {l.error || "не получилось"}
                      </div>
                    ) : (
                      <div key={l.id} className="team-bulk-line">
                        <span className="team-bulk-name">{l.name}</span>
                        <span className="invite-link team-bulk-url">{l.link}</span>
                        <button className="btn btn-small" onClick={() => void copy(l.message || l.link!, "b:" + l.id, "bulk")}>
                          {copied === "b:" + l.id ? "Скопировано" : "Копировать"}
                        </button>
                        {canShare() && (
                          <button className="btn btn-small" onClick={() => void share(l.message || l.link!)}>
                            Поделиться
                          </button>
                        )}
                      </div>
                    ),
                  )}
                </div>
                {!bulk.busy && (
                  <div className="outcome-actions">
                    <button className="btn btn-small" onClick={() => void reload()}>
                      Проверить, кто подключился
                    </button>
                    <button className="btn btn-small" onClick={() => setBulk(null)}>
                      Скрыть
                    </button>
                  </div>
                )}
                <div className="team-hint">
                  «Копировать» берёт готовое сообщение с именем — его можно сразу вставить человеку в чат. «Скопировать всё» —
                  список для общего чата. По ссылке человек подключит бота, откроет трекер на телефоне и скачает приложение для
                  компьютера.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Отбор и поиск — кнопками-плашками, как над доской. На телефоне
            поиска нет (14.10.2026: «на телефоне нет поиска людей»). */}
        {!loading && colleagues.length > 0 && (
          <div className="team-tools">
            <div className="chip-row team-filters" id="teamFilters">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={"participant-chip" + (filter === f.id ? " selected" : "")}
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label} <span className="team-filter-count">{f.count}</span>
                </button>
              ))}
            </div>
            {!isMobile && colleagues.length > 8 && (
              <input
                className="team-search"
                id="teamSearch"
                type="search"
                placeholder="Найти по имени"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
          </div>
        )}

        {loading && <div className="empty">Загрузка…</div>}

        {!loading && colleagues.length === 0 && <div className="empty">Пока никого нет — добавьте людей кнопкой «+ Человек» вверху.</div>}
        {!loading && colleagues.length > 0 && shown.length === 0 && <div className="empty">Никого не нашлось.</div>}

        {!loading && shown.length > 0 && (
          <div className="team-list" id="teamList">
            {shown.map((person) => {
              const where = [person.telegram ? "Telegram" : "", person.max ? "MAX" : ""].filter(Boolean).join(" · ");
              const open = openFor === person.id;
              return (
                <Fragment key={person.id}>
                  {/* Строка человека — сетка из трёх мест: имя, состояние,
                      действия. В строке только то, чего у человека ЕЩЁ НЕТ
                      (пригласить), а всё остальное — в меню ⋮ и в раскрытой
                      карточке: оно делается раз в квартал, а место
                      занимало бы в каждой строке. */}
                  <div
                    className={"team-row" + (justAdded === person.id ? " just-added" : "") + (open ? " open" : "")}
                    data-person={person.id}
                    ref={justAdded === person.id ? revealInvite : undefined}
                  >
                    {/* Имя без пометки «(я)»: она часть строки в базе, а не
                        часть имени, и на этом экране отвечает на вопрос
                        «как меня видят остальные» — то есть должна быть
                        показана ровно так, как её видят они. Нажатие
                        раскрывает карточку человека. */}
                    <button
                      type="button"
                      className="team-person"
                      aria-expanded={open}
                      title="Подробнее"
                      onClick={() => toggleCard(person.id)}
                    >
                      <span className="team-avatar" aria-hidden>
                        {initials(withoutSelfMark(person.name))}
                      </span>
                      <span className="team-name">{withoutSelfMark(person.name)}</span>
                      <span className="team-channels" aria-hidden>
                        {person.telegram && <TelegramBrandIcon size={14} />}
                        {person.max && <MaxBrandIcon size={14} />}
                      </span>
                    </button>

                    {/* Одно состояние на человека, а не два рядом: сначала
                        где он на связи, потом что у него с трекером. */}
                    <span className="team-status">
                      <span className={person.isMe || person.linked ? "linked" : "team-off"}>
                        {person.isMe
                          ? "Это вы — так вас видят остальные"
                          : person.linked
                            ? where + (person.username ? ` · @${person.username}` : "")
                            : "Не подключён"}
                      </span>
                      {isAwayOn(person.awayUntil, today) && (
                        <>
                          {" · "}
                          <span className="team-away">{awayPhrase(person.awayKind, person.awayUntil)}</span>
                        </>
                      )}
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
                      {/* Позвать того, кого ещё нет на связи. Это и есть то,
                          ради чего окно открывают в первый раз. */}
                      {!person.isMe && !person.linked && (
                        <button className="btn btn-small btn-primary team-invite-btn" onClick={() => void handleWelcome(person)}>
                          Пригласить
                        </button>
                      )}
                      <button
                        className="team-more"
                        type="button"
                        title="Ещё действия"
                        aria-label={`Ещё действия: ${person.name}`}
                        onClick={(e) => setMenuFor({ id: person.id, name: person.name, anchor: e.currentTarget.getBoundingClientRect() })}
                      >
                        ⋮
                      </button>
                    </div>
                  </div>

                  {/* Карточка человека: всё, что о нём известно «Команде»,
                      и все действия кнопками — без угадывания, что спрятано
                      за ⋮. Ничего о его работе: только связь, вход и права. */}
                  {open && (
                    <div className="team-detail" id="personDetail">
                      <dl className="team-facts">
                        {!person.isMe && (
                          <>
                            <dt>Telegram</dt>
                            <dd className={person.telegram ? "linked" : ""}>
                              {person.telegram ? (person.username ? `подключён · @${person.username}` : "подключён") : "не подключён"}
                            </dd>
                            {maxBot.available && (
                              <>
                                <dt>MAX</dt>
                                <dd className={person.max ? "linked" : ""}>{person.max ? "подключён" : "не подключён"}</dd>
                              </>
                            )}
                            <dt>Вход в трекер</dt>
                            <dd className={person.member === "active" ? "linked" : ""}>
                              {person.member === "none"
                                ? person.linked
                                  ? "ещё не входил — войдёт через бота"
                                  : "войдёт через бота после приглашения"
                                : MEMBER_LABEL[person.member]}
                            </dd>
                          </>
                        )}
                        {person.member === "active" && (
                          <>
                            <dt>Права</dt>
                            <dd>{MEMBER_ROLE_LABELS[person.role]}</dd>
                          </>
                        )}
                        {person.member !== "none" && (
                          <>
                            <dt>Направление</dt>
                            <dd>{person.direction || "—"}</dd>
                          </>
                        )}
                        {!person.isMe && (
                          <>
                            <dt>Телефон</dt>
                            <dd>
                              {contacts === null ? "…" : contacts[person.id]?.phone ? (
                                <a className="auth-link" style={{ padding: 0 }} href={phoneHref(contacts[person.id].phone)}>
                                  {contacts[person.id].phone}
                                </a>
                              ) : (
                                "не указан"
                              )}
                            </dd>
                            <dt>Рабочая почта</dt>
                            <dd>
                              {contacts === null ? "…" : contacts[person.id]?.email ? (
                                <a className="auth-link" style={{ padding: 0 }} href={"mailto:" + contacts[person.id].email}>
                                  {contacts[person.id].email}
                                </a>
                              ) : (
                                "не указана"
                              )}
                            </dd>
                          </>
                        )}
                        <dt>На месте</dt>
                        <dd>{isAwayOn(person.awayUntil, today) ? awayPhrase(person.awayKind, person.awayUntil) : "да"}</dd>
                      </dl>
                      <div className="team-detail-actions">
                        {menuItemsFor(person).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={"btn btn-small" + (item.id === "remove" ? " team-detail-danger" : "")}
                            onClick={() => item.onSelect()}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {inviteFor?.id === person.id && (
                    <div className="team-invite" id="inviteBlock" ref={revealInvite}>
                      <label>
                        {inviteFor.kind === "access"
                          ? `Новый пароль для ${inviteFor.name} — ${INVITE_LIFETIME.access}`
                          : inviteFor.kind === "welcome"
                            ? `Приглашение для ${inviteFor.name} — ${INVITE_LIFETIME.welcome}`
                            : `Вход по почте и паролю для ${inviteFor.name} — ${INVITE_LIFETIME.tracker}`}
                      </label>
                      {/* Почта здесь единственный раз за весь трекер: войти
                          без неё нельзя, а спросить её больше не у кого. */}
                      {inviteFor.email && <div className="invite-link">Почта для входа: {inviteFor.email}</div>}
                      {inviteFor.message ? (
                        <div className="invite-message" id="inviteMessage">
                          {inviteFor.message}
                        </div>
                      ) : (
                        <div className="invite-link">{inviteFor.link}</div>
                      )}
                      <div className="outcome-actions">
                        <button
                          className="btn btn-small btn-primary"
                          id="copyInviteBtn"
                          onClick={() => void copy(inviteFor.message || inviteFor.link, "one", inviteFor.id)}
                        >
                          {copied === "one" ? "Скопировано" : inviteFor.message ? "Скопировать сообщение" : "Скопировать"}
                        </button>
                        {inviteFor.message && (
                          <button className="btn btn-small" onClick={() => void copy(inviteFor.link, "link", inviteFor.id)}>
                            {copied === "link" ? "Скопировано" : "Только ссылку"}
                          </button>
                        )}
                        {canShare() && inviteFor.kind !== "access" && (
                          <button className="btn btn-small" onClick={() => void share(inviteFor.message || inviteFor.link)}>
                            Поделиться…
                          </button>
                        )}
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

                  {removing?.id === person.id && (
                    <div className="team-invite team-remove" id="removeBlock" ref={revealInvite}>
                      <label>
                        Убрать {removing.name} из команды. На нём открыто:{" "}
                        {[
                          removing.openTasks ? `задач — ${removing.openTasks}` : "",
                          removing.openMeetings ? `встреч — ${removing.openMeetings}` : "",
                        ]
                          .filter(Boolean)
                          .join(", ")}
                        .
                      </label>
                      {removing.sample.length > 0 && (
                        <ul className="team-remove-sample">
                          {removing.sample.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      )}
                      <div className="team-hint team-remove-ask">Кому передать? Задачи и встречи перейдут к нему вместе с перепиской.</div>
                      <div className="chip-row" id="removeReceivers">
                        {colleagues
                          .filter((p) => p.id !== removing.id)
                          .map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className={"participant-chip" + (removing.to === p.id ? " selected" : "")}
                              aria-pressed={removing.to === p.id}
                              onClick={() => setRemoving({ ...removing, to: p.id })}
                            >
                              {p.isMe ? "Себе" : withoutSelfMark(p.name)}
                            </button>
                          ))}
                      </div>
                      <div className="outcome-actions team-remove-actions">
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          id="removeConfirmBtn"
                          disabled={!removing.to || removing.busy}
                          onClick={() => void finishRemove(removing.id, removing.name, removing.to)}
                        >
                          {removing.busy ? "Передаю…" : "Передать и убрать"}
                        </button>
                        <button type="button" className="btn btn-small" onClick={() => setRemoving(null)}>
                          Не убирать
                        </button>
                      </div>
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
                title={withoutSelfMark(menuFor.name)}
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
            Бот в MAX не подключён — в приглашениях только Telegram.{" "}
            <a className="auth-link" style={{ padding: 0 }} href="/max">
              Подключить
            </a>
          </div>
        )}

        {/* Убранные — внизу и свёрнуто: нужны, когда человек вернулся или
            убрали не того. Возврат приносит назад и его историю. */}
        {!loading && (
          <div className="team-archived">
            <button type="button" className="btn btn-small" id="archivedToggle" onClick={() => void toggleArchived()}>
              {archived ? "Скрыть убранных" : "Убранные из команды"}
            </button>
            {archived && archived.length === 0 && <div className="team-hint">Никого не убирали.</div>}
            {archived && archived.length > 0 && (
              <div className="team-list" id="archivedList">
                {archived.map((p) => (
                  <div key={p.id} className="team-row">
                    <span className="team-name">{withoutSelfMark(p.name)}</span>
                    <span className="team-status">убран {new Date(p.archivedAt).toLocaleDateString("ru-RU")}</span>
                    <div className="team-cell">
                      <button type="button" className="btn btn-small" onClick={() => void handleRestore(p.id, p.name)}>
                        Вернуть
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {error?.id === "archived" && <div className="team-error">{error.text}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}
