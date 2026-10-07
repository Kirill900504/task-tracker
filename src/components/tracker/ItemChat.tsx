"use client";

import { useEffect, useRef, useState } from "react";
import { REACTIONS, useItemComments, type Comment, type ItemKind } from "@/hooks/useItemComments";
import { useAsk } from "@/components/Ask";
import ChatMessageMenu, { type ChatMenuAction } from "./ChatMessageMenu";
import Icon from "./Icon";
import FileList from "./FileList";
import MicButton from "./MicButton";
import { humanError } from "@/lib/humanError";
import { withoutSelfMark } from "@/lib/actorName";
import { ChatMuteButton } from "./AlertsButton";

// Обсуждение задачи там же, где задача.
//
// Everyone on the item reads the whole thread — no private branches. That is
// simpler to reason about and it is the point of having the conversation
// inside the task at all: a thread nobody can quietly split is a record,
// and a record is what stops «мы же договорились» from being one person's
// word against another's.
//
// Reactions are a fixed set. An open picker looks generous and then does not
// survive the trip into a messenger, where a message is text and a reaction
// has to be rendered as a line under it.

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

// Имя автора — своим цветом, одним и тем же у одного человека.
//
// В переписке на четырнадцать человек имя, набранное тем же серым, что и
// всё вокруг, не отвечает на вопрос «кто это писал» — его приходится
// ЧИТАТЬ. Цвет отвечает раньше чтения, и именно так устроены групповые
// чаты в Telegram и MAX, на которые Кирилл и попросил равняться. Цвет
// считается из имени, а не назначается: список людей меняется, а подпись
// одного и того же человека меняться не должна.
const NAME_COLORS = ["#6FB1D4", "#C99BE0", "#7FC9A0", "#E0A96D", "#E08B9E", "#8FA6E8", "#5FC2C2", "#D0B45F"];

function colorOf(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum = (sum * 31 + name.charCodeAt(i)) % 100000;
  return NAME_COLORS[sum % NAME_COLORS.length];
}

// Кружок с буквами вместо фотографии: снимков людей в трекере нет и не
// предвидится, а без чего-то слева реплики теряют своего автора, как
// только их становится больше трёх.
function initialsOf(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Один день — одна разделительная строка, как в мессенджере.
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === yesterday.toDateString()) return "Вчера";
  const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const sameYear = d.getFullYear() === today.getFullYear();
  return `${d.getDate()} ${months[d.getMonth()]}${sameYear ? "" : " " + d.getFullYear()}`;
}

function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return !Number.isNaN(x.getTime()) && !Number.isNaN(y.getTime()) && x.toDateString() === y.toDateString();
}

// Обрывок цитаты — коротко, чтобы полоска не превращалась в отдельное
// сообщение. Файл без текста называется словом, а не пустой строкой.
function quoteSnippet(body: string): string {
  const text = body.trim() || "📎 файл";
  return text.length > 80 ? text.slice(0, 80) + "…" : text;
}

// Строка хроники — это ярлык действия и, часто, слово человека рядом с
// ним («вернул на доработку: ВСЕРАВНО ДЕЛА!!!!!!»). Оба пишутся сервером
// одной строкой через ": ", и здесь она разбирается обратно на две части
// ради ровно того, что Кирилл попросил 23.09.2026 — «надо чтобы больше
// выделялось именно сообщение... а событие было чуть менее заметно».
// Метка никогда не содержит ": " сама — она всегда одна из
// фиксированных фраз («вернул на доработку», «принял в работу» и т.п.),
// поэтому первое вхождение и есть граница.
function splitEvent(body: string): { label: string; comment: string | null } {
  const at = body.indexOf(": ");
  if (at === -1) return { label: body, comment: null };
  return { label: body.slice(0, at), comment: body.slice(at + 2) || null };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Разбирает текст на обычные куски и узнанные «@Имя Фамилия», чтобы тег
// человека внутри реплики читался раньше остального текста — тем же
// приёмом, что цвет имени над чужой репликой. Список кандидатов — участники
// именно этой задачи/встречи, а не всё пространство: тегнуть можно только
// того, кто и так эту переписку видит.
function renderWithMentions(body: string, candidates: string[]) {
  if (!candidates.length || !body.includes("@")) return body;
  const names = [...new Set(candidates)].filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegExp);
  if (!names.length) return body;
  const re = new RegExp(`@(?:${names.join("|")})`, "g");
  const parts: Array<string | { key: number; text: string }> = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    parts.push({ key: key++, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  if (parts.length <= 1 && typeof parts[0] === "string") return body;
  return parts.map((p) =>
    typeof p === "string" ? p : (
      <span className="chat-mention" key={p.key} style={{ color: colorOf(p.text.slice(1)) }}>
        {p.text}
      </span>
    ),
  );
}

// «@» напечатан и следом — слово без пробела: то, что сейчас набирают как
// упоминание. Курсор предполагается в конце поля — этого достаточно для
// того, как обычно печатают, и не требует таскать по всему компоненту
// позицию выделения ради довольно редкого действия.
function activeMentionQuery(draft: string): string | null {
  const at = draft.lastIndexOf("@");
  if (at === -1) return null;
  const rest = draft.slice(at + 1);
  if (/\s/.test(rest)) return null;
  return rest;
}

function applyMention(draft: string, name: string): string {
  const at = draft.lastIndexOf("@");
  return draft.slice(0, at) + "@" + name + " ";
}

// Кого можно тегнуть: имена без пометки «(я)», без повторов и без
// заглушек вместо имени («владелец», «бывший участник» — так подписывается
// постановщик, когда имени не нашлось, и тегнуть такую строку некого).
export function mentionPeople(names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = withoutSelfMark(raw || "").trim();
    if (!name || name === "владелец" || name === "бывший участник" || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

// Быстрые реакции — те, что ставят чаще всего, одним нажатием при
// наведении на сообщение, как в Slack и Telegram Desktop. Полный набор
// по-прежнему в меню по правой кнопке; здесь — только чтобы «👍 ок» не
// стоило двух нажатий и прицеливания в меню.
const QUICK_REACTIONS = ["👍", "✅", "🔥", "🙏"] as const;

function fmtWhen(p: { date: string; time: string }): string {
  return `${p.date.split("-").reverse().join(".")}, ${p.time}`;
}

export default function ItemChat({
  kind,
  itemId,
  mentionCandidates = [],
  onAcceptProposal,
}: {
  kind: ItemKind;
  itemId: string;
  // Кого можно тегнуть — участники этого же элемента. Пусто — подсказка и
  // подсветка просто не появляются, форма ввода при этом работает как раньше.
  mentionCandidates?: string[];
  // Есть только у организатора встречи: перенести её на время, которое
  // предложил участник, — одним нажатием на самом предложении.
  onAcceptProposal?: (proposal: { date: string; time: string; reason: string; by: string }) => void;
}) {
  // «По задаче» в обсуждении встречи — мелочь, но именно из таких мелочей
  // складывается ощущение, что окно собрано из чужих кусков.
  const about = kind === "meeting" ? "встрече" : kind === "idea" ? "мысли" : "задаче";
  const { comments, loading, send, edit, remove, react } = useItemComments(kind, itemId);
  const ask = useAsk();
  const [draft, setDraft] = useState("");
  // Меню сообщения: какое сообщение и в какой точке экрана его открыли.
  const [menuFor, setMenuFor] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  // Долгое нажатие — правая кнопка телефона. Таймер один на весь список:
  // одновременно жать два сообщения нельзя.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState("");
  // Выбранные, но ещё не отправленные файлы. Показываются списком до
  // отправки: «покажи, что сделал» чаще всего означает две фотографии, и
  // ошибиться файлом легко.
  const [pending, setPending] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  // На какое сообщение отвечают прямо сейчас — «ответить» и «цитировать»
  // это одно и то же действие: composer несёт ссылку, а лента рисует сверху
  // цитату с автором и обрывком текста.
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  // Правка на месте — то же поле, что у отправки, но внутри самого пузыря:
  // «сделай как в классических мессенджерах» (23.09.2026), без отдельного
  // окна.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // Сообщение, к которому только что перевели взгляд по цитате, — на
  // секунду подсвечивается и само по себе гаснет.
  const [flashId, setFlashId] = useState<string | null>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  // Лента прокручивается к последнему сообщению — как любой мессенджер.
  //
  // Без этого переписка открывается на первой реплике, и чтобы увидеть то,
  // ради чего карточку открыли, надо листать вниз через весь разговор.
  // Прокручиваем на каждое изменение длины ленты: и при открытии, и когда
  // пришло чужое сообщение, и когда отправили своё.
  const feed = useRef<HTMLDivElement>(null);
  const count = comments.length;
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  // Долгое нажатие на телефоне открывает то же меню, что правая кнопка на
  // компьютере: 450 мс — граница, на которой обычное нажатие ещё не
  // считается долгим, а удержание уже не кажется задержкой. Движение пальцем
  // отменяет: иначе меню открывается при каждой прокрутке ленты.
  function longPressProps(id: string) {
    const cancel = () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
      pressTimer.current = null;
    };
    return {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        const { clientX: x, clientY: y } = t;
        cancel();
        pressTimer.current = setTimeout(() => setMenuFor({ id, at: { x, y } }), 450);
      },
      onTouchMove: cancel,
      onTouchEnd: cancel,
      onTouchCancel: cancel,
    };
  }

  // Поле пустеет сразу, а не после ответа облака.
  //
  // Раньше здесь стояло `await send(...)`, и всё окно на секунду замирало:
  // кнопка «Отправляю…», текст всё ещё в поле, ленты не изменилось. Человек
  // в этот момент видит ровно то же, что видел бы при поломке, — и жмёт
  // второй раз. Сообщение теперь появляется в ленте мгновенно (см.
  // useItemComments), поэтому и поле должно освободиться мгновенно: набрать
  // следующее можно, не дожидаясь ничего.
  function handleSend() {
    const text = draft.trim();
    if (!text && !pending.length) return;
    const files = pending;
    const quoting = replyTo;
    setDraft("");
    setPending([]);
    setError("");
    setReplyTo(null);
    void send(text, files, quoting).catch((e) => {
      // Не ушло — текст, файлы и цитата возвращаются на место: повторить
      // это одно нажатие, а набирать заново никто не станет. Если человек
      // успел начать следующее сообщение, его не трогаем.
      setDraft((current) => current || text);
      setPending((current) => (current.length ? current : files));
      setReplyTo((current) => current || quoting);
      setError(humanError(e, "Не отправилось. Проверьте связь и нажмите ещё раз."));
    });
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

  function startEdit(c: Comment) {
    setEditingId(c.id);
    setEditDraft(c.body);
  }

  function saveEdit() {
    const id = editingId;
    if (!id) return;
    const next = editDraft.trim();
    if (!next) {
      // Пустое сообщение — это удаление; не подменяем одно другим молча.
      setError("Пустое сообщение — это удаление; используйте «Убрать» в меню.");
      return;
    }
    setEditingId(null);
    void edit(id, next);
  }

  async function handleRemove(id: string) {
    const yes = await ask.confirm({
      question: "Убрать это сообщение из обсуждения?",
      okText: "Убрать",
      danger: true,
    });
    if (!yes) return;
    void remove(id);
  }

  // Цитата ведёт к оригиналу: прокручивает его в видимую область и на
  // секунду подсвечивает — иначе «куда меня привело» ищут глазами по всей
  // ленте.
  function jumpTo(id: string) {
    const el = feed.current?.querySelector<HTMLElement>(`[data-comment-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1400);
  }

  const mentionQuery = activeMentionQuery(draft);
  const mentionHits =
    mentionQuery !== null
      ? mentionCandidates.filter((n) => n.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
      : [];

  function pickMention(name: string) {
    setDraft((cur) => applyMention(cur, name));
    draftRef.current?.focus();
  }

  return (
    <div
      className="chat"
      // По этой метке всплывающее уведомление узнаёт, что обсуждение уже
      // открыто перед глазами, и не повторяет его (useDesktopAlerts).
      data-chat={kind + ":" + itemId}
      // Файл, брошенный на обсуждение мышью из папки, — вложение, как в
      // любом мессенджере. Перетаскивание карточек трекера сюда не
      // относится: оно на pointer-событиях (dnd-kit) и dataTransfer не
      // несёт, поэтому `Files` в типах — признак файла с диска.
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        pickFiles(e.dataTransfer.files);
      }}
    >
      <div className="chat-head">
        <span className="chat-title">Обсуждение</span>
        {comments.length > 0 && <span className="chat-count">{comments.length}</span>}
        {/* Правая кнопка — единственное, о чём нельзя догадаться, глядя на
            ветку: под сообщениями теперь ничего не написано. Одна строка
            справа от заголовка стоит дешевле, чем три подписи под каждой
            репликой, которые она заменила. */}
        {comments.some((c) => !c.system) && (
          <span className="chat-hint">Правая кнопка на сообщении — реакции и действия</span>
        )}
        {kind !== "idea" && <ChatMuteButton kind={kind} itemId={itemId} />}
      </div>

      {/* Пока лента едет — её форма, а не слово о ней.
          Замер 20.09.2026: обсуждение открывается за 106 мс, а сообщения
          приезжают через 830 — и всё это время в карточке стояло
          «Загрузка…». То же самое, что было на старте трекера, только в
          миниатюре: ждать нормально, читать о том, что ждёшь, — нет.
          Три полосы разной длины, как реплики разной длины. */}
      {/* Лента — как в мессенджере: своё справа, чужое слева.
          Слова Кирилла 21.09.2026: «сделай современный чат, с возможностью
          быстро переписываться с функциями чата и удобным отображением
          имён участников, режим чата как в телеграм или МАХ (когда твои
          сообщения справа, сообщения коллег слева)».

          Место ленты занято ВСЕГДА — и пока она едет, и когда она пуста.
          07.10.2026: «на долю секунды появляется пустой чат, а потом сразу
          же чат с историей». Пустой кадр был не только пустым, но и другой
          формы: без ленты поле ввода поднималось под самый заголовок, а с
          приходом сообщений уезжало вниз — окно прыгало. Теперь меняется
          только содержимое ленты, а поле стоит на своём месте. */}
      <div className={"chat-feed" + (loading || comments.length === 0 ? " is-empty" : "")} ref={feed}>
        {loading && (
          <div className="chat-skeleton" aria-hidden>
            <div className="chat-skel-line" style={{ width: "62%" }} />
            <div className="chat-skel-line" style={{ width: "44%" }} />
            <div className="chat-skel-line" style={{ width: "71%" }} />
          </div>
        )}
        {!loading && comments.length === 0 && (
          <div className="chat-empty">
            Пока тихо. Здесь видно всё, что говорили по {about}, — и это видят все её участники.
          </div>
        )}
        {!loading && comments.length > 0 && (
        <>
          {comments.map((c, i) => {
            const prev = comments[i - 1];
            const newDay = !prev || !sameDay(prev.createdAt, c.createdAt);
            // Подряд идущие реплики одного человека — без повторной подписи
            // и без второго кружка: так в любом мессенджере, и так три
            // фразы подряд остаются одной репликой, а не тремя карточками.
            const sameAuthor = !!prev && !prev.system && !c.system && prev.authorName === c.authorName && !newDay;
            const day = newDay ? dayLabel(c.createdAt) : "";
            const editingThis = editingId === c.id;
            return (
              <div className="chat-line-group" key={c.id}>
                {day && (
                  <div className="chat-day">
                    <span>{day}</span>
                  </div>
                )}
                {/* Хроника — не реплика: её нельзя править и убрать (это
                    отметка на полях, а не сообщение человека), но
                    отвечать на неё и ставить реакции — можно, ровно как
                    на обычное сообщение. Именно она отвечает на «а что
                    просили доделать» после второго возврата: состояние
                    задачи этого уже не помнит (см. itemHistory.ts).
                    23.09.2026: ярлык события и слово человека при этом —
                    разной важности. «Вернул на доработку» — метка, ниже
                    которой всегда можно посмотреть; «ВСЕРАВНО ДЕЛА» — то,
                    из-за чего карточку открывают, и должно читаться
                    первым. */}
                {c.system ? (() => {
                  const { label, comment } = splitEvent(c.body);
                  return (
                    <div
                      className={"chat-event" + (menuFor?.id === c.id ? " menu-open" : "") + (flashId === c.id ? " flash" : "")}
                      data-comment-id={c.id}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenuFor({ id: c.id, at: { x: e.clientX, y: e.clientY } });
                      }}
                      {...longPressProps(c.id)}
                    >
                      <div className="chat-event-row">
                        <span className="chat-event-text">{label}</span>
                        <span className="chat-event-time">{timeLabel(c.createdAt)}</span>
                      </div>
                      {comment && <div className="chat-event-comment">{renderWithMentions(comment, mentionCandidates)}</div>}
                      {c.reactions.length > 0 && (
                        <div className="chat-foot">
                          {c.reactions.map((r) => (
                            <button
                              key={r.emoji}
                              type="button"
                              className={"chat-reaction" + (r.mine ? " mine" : "")}
                              title={(c.reactors?.[r.emoji]?.join(", ") || "") + (r.mine ? " · нажмите, чтобы убрать" : "") || "Поддержать"}
                              onClick={() => void react(c.id, r.emoji, !r.mine)}
                            >
                              {r.emoji} {r.count}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })() : (
                  <div className={"chat-row" + (c.mine ? " mine" : "") + (sameAuthor ? " tight" : "")}>
                    {!c.mine &&
                      (sameAuthor ? (
                        <span className="chat-avatar hidden" aria-hidden />
                      ) : (
                        <span className="chat-avatar" style={{ background: colorOf(c.authorName) }} title={c.authorName}>
                          {initialsOf(c.authorName)}
                        </span>
                      ))}
                    {/* Сообщение, которое ещё едет в облако, меню не
                        открывает: править и убирать нечего — строки, к
                        которой это относится, пока нет. Видно это по
                        бледности, и длится обычно меньше мига. */}
                    <div
                      className={
                        "chat-msg" +
                        (c.mine ? " mine" : "") +
                        (c.sending ? " sending" : "") +
                        (menuFor?.id === c.id ? " menu-open" : "") +
                        (flashId === c.id ? " flash" : "")
                      }
                      data-comment-id={c.id}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (c.sending || editingThis) return;
                        setMenuFor({ id: c.id, at: { x: e.clientX, y: e.clientY } });
                      }}
                      {...(c.sending || editingThis ? {} : longPressProps(c.id))}
                    >
                      {!c.mine && !sameAuthor && (
                        <div className="chat-author" style={{ color: colorOf(c.authorName) }}>
                          {c.authorName}
                        </div>
                      )}

                      {c.replyTo && (
                        <div className="chat-quote" onClick={() => jumpTo(c.replyTo!.id)}>
                          <span className="chat-quote-author" style={{ color: colorOf(c.replyTo.authorName) }}>
                            {c.replyTo.authorName}
                          </span>
                          <span className="chat-quote-body">{quoteSnippet(c.replyTo.body)}</span>
                        </div>
                      )}

                      {editingThis ? (
                        <div className="chat-edit-box">
                          <textarea
                            autoFocus
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                saveEdit();
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingId(null);
                              }
                            }}
                            rows={Math.min(6, Math.max(2, editDraft.split("\n").length))}
                          />
                          <div className="chat-edit-actions">
                            <button type="button" className="btn btn-small" onClick={() => setEditingId(null)}>
                              Отмена
                            </button>
                            <button type="button" className="btn btn-small btn-primary" onClick={saveEdit}>
                              Сохранить
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {c.proposal ? (
                            (() => {
                              // Предложение другого времени — карточкой, а не
                              // текстом: дата крупно, ответы участников по
                              // именам и, у организатора, перенос одним
                              // нажатием. «Подходит / Не подходит» — это 👍 / 👎
                              // на реплику, один из двух.
                              const yes = c.reactors?.["👍"] || [];
                              const no = c.reactors?.["👎"] || [];
                              const myYes = c.reactions.some((r) => r.emoji === "👍" && r.mine);
                              const myNo = c.reactions.some((r) => r.emoji === "👎" && r.mine);
                              const reason = (c.body.split(" — ")[1] || "").split(".\n")[0].trim();
                              const choose = (emoji: "👍" | "👎") => {
                                const on = emoji === "👍" ? !myYes : !myNo;
                                if (on && emoji === "👍" && myNo) void react(c.id, "👎", false);
                                if (on && emoji === "👎" && myYes) void react(c.id, "👍", false);
                                void react(c.id, emoji, on);
                              };
                              return (
                                <div className="chat-proposal">
                                  <div className="chat-proposal-head">
                                    <Icon name="clock" size={14} /> Предлагает перенести на <b>{fmtWhen(c.proposal)}</b>
                                  </div>
                                  {reason && <div className="chat-proposal-reason">{reason}</div>}
                                  <div className="chat-proposal-votes">
                                    {yes.length > 0 && <span className="yes">Подходит: {yes.join(", ")}</span>}
                                    {no.length > 0 && <span className="no">Не подходит: {no.join(", ")}</span>}
                                    {!yes.length && !no.length && <span className="none">Пока никто не ответил</span>}
                                  </div>
                                  {!c.sending && (
                                    <div className="chat-proposal-actions">
                                      {!c.mine && (
                                        <>
                                          <button type="button" className={"btn btn-small" + (myYes ? " on-yes" : "")} onClick={() => choose("👍")}>
                                            👍 Подходит
                                          </button>
                                          <button type="button" className={"btn btn-small" + (myNo ? " on-no" : "")} onClick={() => choose("👎")}>
                                            👎 Не подходит
                                          </button>
                                        </>
                                      )}
                                      {onAcceptProposal && (
                                        <button
                                          type="button"
                                          className="btn btn-small btn-primary"
                                          onClick={() => onAcceptProposal({ ...c.proposal!, reason, by: c.authorName })}
                                        >
                                          <Icon name="calendar" size={14} /> Перенести на это время
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })()
                          ) : (
                            c.body && <div className="chat-body">{renderWithMentions(c.body, mentionCandidates)}</div>
                          )}

                          {/* Фотографию показываем, остальное называем: акт и
                              выгрузку узнают по имени, а установленную кассу — нет. */}
                          <FileList className="chat-files" files={c.attachments} />

                          {/* Время — в углу пузыря, как в мессенджере: оно
                              нужно взглядом, а не чтением, и строки над
                              сообщением ради него больше нет. */}
                          <span className="chat-time">
                            {timeLabel(c.createdAt)}
                            {c.editedAt ? " · изм." : ""}
                            {SOURCE_MARK[c.source] || ""}
                          </span>

                          {/* Быстрые реакции — при наведении, одним нажатием
                              (как в Slack и Telegram Desktop). На телефоне
                              наведения нет, там то же самое делает долгое
                              нажатие с полным набором. */}
                          {!c.sending && !c.proposal && (
                            <div className="chat-quick" onClick={(e) => e.stopPropagation()}>
                              {QUICK_REACTIONS.map((emoji) => {
                                const on = c.reactions.some((r) => r.emoji === emoji && r.mine);
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className={"chat-quick-btn" + (on ? " on" : "")}
                                    title={on ? "Убрать реакцию" : "Поставить реакцию"}
                                    onClick={() => void react(c.id, emoji, !on)}
                                  >
                                    {emoji}
                                  </button>
                                );
                              })}
                              <button
                                type="button"
                                className="chat-quick-btn"
                                title="Ответить на это сообщение"
                                onClick={() => {
                                  setReplyTo(c);
                                  draftRef.current?.focus();
                                }}
                              >
                                <Icon name="reply" size={14} />
                              </button>
                            </div>
                          )}

                          {/* Под сообщением — только реакции, которые уже стоят.
                              «изменить», «убрать» и выбор эмодзи живут в меню по
                              правой кнопке: три служебных слова под КАЖДОЙ
                              репликой — это ветка, которую читаешь через подписи
                              к ней. */}
                          {c.reactions.length > 0 && (
                            <div className="chat-foot">
                              {c.reactions.map((r) => (
                                <button
                                  key={r.emoji}
                                  type="button"
                                  className={"chat-reaction" + (r.mine ? " mine" : "")}
                                  title={(c.reactors?.[r.emoji]?.join(", ") || "") + (r.mine ? " · нажмите, чтобы убрать" : "") || "Поддержать"}
                                  onClick={() => void react(c.id, r.emoji, !r.mine)}
                                >
                                  {r.emoji} {r.count}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
        )}
      </div>

      {/* Меню сообщения — одно на всю ветку, а не по штуке на реплику:
          открыто всегда не больше одного. */}
      {menuFor && (() => {
        const c = comments.find((x) => x.id === menuFor.id);
        if (!c) return null;
        const actions: ChatMenuAction[] = [];
        // Цитата события — тем же механизмом, что у реплики, но своей
        // подписью: «authorName» у системной строки — служебное значение
        // (см. itemHistory.ts, автора у неё нет), и в цитате оно не
        // должно читаться как «это сказал Кирилл».
        actions.push({
          id: "reply",
          label: "Ответить",
          onSelect: () => setReplyTo(c.system ? { ...c, authorName: "Событие" } : c),
        });
        if (c.body) {
          actions.push({
            id: "copy",
            label: "Копировать текст",
            onSelect: () => void navigator.clipboard?.writeText(c.body).catch(() => {}),
          });
        }
        if (c.mine) {
          actions.push({ id: "edit", label: "Изменить", onSelect: () => startEdit(c) });
          actions.push({ id: "remove", label: "Убрать", danger: true, onSelect: () => void handleRemove(c.id) });
        }
        return (
          <ChatMessageMenu
            at={menuFor.at}
            emojis={REACTIONS}
            activeEmojis={c.reactions.filter((r) => r.mine).map((r) => r.emoji)}
            onPickEmoji={(emoji) => {
              const already = c.reactions.find((r) => r.emoji === emoji)?.mine || false;
              void react(c.id, emoji, !already);
            }}
            actions={actions}
            onClose={() => setMenuFor(null)}
          />
        );
      })()}

      {error && <div className="chat-error">{error}</div>}

      {pending.length > 0 && (
        <div className="chat-pending">
          {pending.map((f, i) => (
            <span className="chat-pending-item" key={f.name + i}>
              <Icon name="clip" size={14} /> {f.name} <span className="chat-pending-size">{sizeLabel(f.size)}</span>
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

      {/* Ответ, который набирают, — цитата над полем: composer ссылается
          на конкретное сообщение до того, как нажали «Отправить», а не
          после. Крестик снимает выбор без потери набранного текста. */}
      {replyTo && (
        <div className="chat-reply-bar">
          <div className="chat-reply-bar-text">
            <span className="chat-quote-author" style={{ color: colorOf(replyTo.authorName) }}>
              {replyTo.authorName}
            </span>
            <span className="chat-quote-body">{quoteSnippet(replyTo.body)}</span>
          </div>
          <button type="button" className="chat-reply-bar-close" aria-label="Не отвечать на это сообщение" onClick={() => setReplyTo(null)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      {/* Подсказка @упоминания — прямо над полем, а не всплывающим окном:
          она следует за тем, что печатается, не отдельным слоем поверх
          всего. */}
      {mentionHits.length > 0 && (
        <div className="chat-mention-list">
          {mentionHits.map((name) => (
            <button key={name} type="button" className="chat-mention-item" onClick={() => pickMention(name)}>
              @{name}
            </button>
          ))}
        </div>
      )}

      <div className="chat-composer">
        <textarea
          ref={draftRef}
          value={draft}
          placeholder={`Написать по ${about}… ${mentionCandidates.length ? "(@ — позвать кого-то из участников)" : ""}`}
          onChange={(e) => setDraft(e.target.value)}
          // Снимок экрана вставляется прямо в поле (Ctrl+V), как в любом
          // мессенджере: «покажи, что сделал» чаще всего и есть скриншот, и
          // сохранять его в файл ради кнопки со скрепкой — лишние шаги.
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files || []);
            if (!files.length) return;
            e.preventDefault();
            pickFiles(e.clipboardData.files);
          }}
          onKeyDown={(e) => {
            // Enter отправляет, Shift+Enter переносит строку: сообщение в
            // обсуждении почти всегда одно предложение. Пока открыт список
            // подсказок, Enter выбирает первую — тем же движением, что и
            // отправка, только раньше.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (mentionHits.length) pickMention(mentionHits[0]);
              else void handleSend();
            }
            if (e.key === "Escape" && replyTo) {
              setReplyTo(null);
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
        {/* Диктовка — тот же микрофон, что у названия задачи и мысли.
            Отзыв Витовского 25.09.2026: «добавить голосовой ввод в
            обсуждениях». Надиктованное дописывается в поле, а не уходит
            само: распознавание ошибается, и прочесть перед отправкой
            дешевле, чем исправлять отправленное. */}
        <MicButton value={draft} onChange={setDraft} title="Надиктовать сообщение" />
        <button
          type="button"
          className="btn btn-small chat-clip"
          title="Приложить файл"
          aria-label="Приложить файл"
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="clip" size={16} />
        </button>
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={!draft.trim() && !pending.length}
          onClick={handleSend}
        >
          {/* «Отправляю…» на кнопке больше нет, и не потому, что стало
              некогда: теперь это видно на самом сообщении — оно уже в ленте и
              бледнеет, пока не подтвердится. Подпись, повторяющая то, что и
              так на экране, — это та самая надпись ни о чём. */}
          <Icon name="send" size={15} /> Отправить
        </button>
      </div>
    </div>
  );
}
