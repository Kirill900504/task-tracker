"use client";

import { useRef, useState } from "react";
import { REACTIONS, useItemComments, type ItemKind } from "@/hooks/useItemComments";
import { useAsk } from "@/components/Ask";
import ChatMessageMenu, { type ChatMenuAction } from "./ChatMessageMenu";
import Icon from "./Icon";

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
    setDraft("");
    setPending([]);
    setError("");
    void send(text, files).catch((e) => {
      // Не ушло — текст и файлы возвращаются на место: повторить это одно
      // нажатие, а набирать и прикладывать заново никто не станет. Если
      // человек успел начать следующее сообщение, его не трогаем.
      setDraft((current) => current || text);
      setPending((current) => (current.length ? current : files));
      setError(e instanceof Error ? e.message : "Не отправилось. Проверьте связь и нажмите ещё раз.");
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

  async function handleEdit(id: string, current: string) {
    const next = await ask.ask({
      title: "Изменить сообщение",
      question: "Как должно быть написано?",
      value: current,
      multiline: true,
      okText: "Сохранить",
      required: "Пустое сообщение — это удаление; закройте окно и нажмите «убрать».",
    });
    if (next === null) return;
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

  return (
    <div className="chat">
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
      </div>

      {/* Пока лента едет — её форма, а не слово о ней.
          Замер 20.09.2026: обсуждение открывается за 106 мс, а сообщения
          приезжают через 830 — и всё это время в карточке стояло
          «Загрузка…». То же самое, что было на старте трекера, только в
          миниатюре: ждать нормально, читать о том, что ждёшь, — нет.
          Три полосы разной длины, как реплики разной длины. */}
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

      {comments.map((c) =>
        // Хроника — не реплика. Её никто не писал, её нельзя править, на неё
        // не ставят реакции, и выглядеть она должна как отметка на полях, а
        // не как чьё-то сообщение. Именно она отвечает на вопрос «а что
        // просили доделать» после второго возврата: состояние задачи этого
        // уже не помнит (см. itemHistory.ts).
        c.system ? (
          <div className="chat-event" key={c.id}>
            <span className="chat-event-text">{c.body}</span>
            <span className="chat-event-time">{timeLabel(c.createdAt)}</span>
          </div>
        ) : (
        // Сообщение, которое ещё едет в облако, меню не открывает: править и
        // убирать нечего — строки, к которой это относится, пока нет. Видно
        // это по бледности, и длится обычно меньше мига.
        <div
          className={
            "chat-msg" +
            (c.mine ? " mine" : "") +
            (c.sending ? " sending" : "") +
            (menuFor?.id === c.id ? " menu-open" : "")
          }
          key={c.id}
          onContextMenu={(e) => {
            e.preventDefault();
            if (c.sending) return;
            setMenuFor({ id: c.id, at: { x: e.clientX, y: e.clientY } });
          }}
          {...(c.sending ? {} : longPressProps(c.id))}
        >
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
                    <span className="chat-file-name">
                      <Icon name="clip" size={14} /> {a.name}
                    </span>
                  )}
                </a>
              ))}
            </div>
          )}

          {/* Под сообщением — только реакции, которые уже стоят. «изменить»,
              «убрать» и кнопка выбора эмодзи отсюда ушли в меню по правой
              кнопке: три служебных слова под КАЖДОЙ репликой — это ветка,
              которую читаешь через подписи к ней. Пустая строка не
              рисуется вовсе, поэтому обсуждение без реакций выглядит
              обсуждением, а не панелью управления. */}
          {c.reactions.length > 0 && (
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
            </div>
          )}
        </div>
        ),
      )}

      {/* Меню сообщения — одно на всю ветку, а не по штуке на реплику:
          открыто всегда не больше одного. */}
      {menuFor && (() => {
        const c = comments.find((x) => x.id === menuFor.id);
        if (!c) return null;
        const actions: ChatMenuAction[] = [];
        if (c.body) {
          actions.push({
            id: "copy",
            label: "Копировать текст",
            onSelect: () => void navigator.clipboard?.writeText(c.body).catch(() => {}),
          });
        }
        if (c.mine) {
          actions.push({ id: "edit", label: "Изменить", onSelect: () => void handleEdit(c.id, c.body) });
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

      <div className="chat-composer">
        <textarea
          value={draft}
          placeholder={`Написать по ${about}…`}
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
