"use client";

import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import { speechErrorText, useSpeechInput } from "@/hooks/useSpeechInput";
import { useAsk } from "@/components/Ask";
import { createPortal } from "react-dom";
import Icon from "@/components/tracker/Icon";

export type TaskFields = {
  title: string;
  description: string;
  assignee: string;
  // Остальные исполнители той же задачи. Фраза «поручи Игорю и Никите»
  // раньше превращалась в две одинаковые задачи — по одной на каждого.
  executors?: string[];
  term: "short" | "long";
  deadline: string;
};
export type MeetingFields = { title: string; date: string; time: string; participants: string[]; durationMin?: number };
export type IdeaFields = { text: string; important: boolean };
// One action item pulled out of dictated meeting notes, awaiting confirmation.
export type ExtractedTask = { title: string; assignee: string; deadline: string };
// The still-open meeting a dictated recap turned out to be about, when the
// server matched one — offered for closing along with the action items.
export type MatchedMeeting = { id: string; title: string; date: string; result: string };

type QuickAddItem =
  | { tool: "create_task"; input: TaskFields; droppedNames: string[] }
  | { tool: "create_meeting"; input: MeetingFields; droppedNames: string[] }
  | { tool: "create_idea"; input: IdeaFields; droppedNames: string[] }
  | { tool: "ask_clarifying_question"; input: { question: string }; droppedNames: string[] }
  | { tool: "manage_item"; input: { action: string; itemType: string; query: string }; droppedNames: string[] }
  | { tool: "answer_question"; input: { answer?: string; query?: string }; droppedNames: string[] }
  | { tool: "meeting_notes"; input: { summary?: string; tasks?: ExtractedTask[]; meeting?: MatchedMeeting | null }; droppedNames: string[] }
  | { tool: "cant_help"; input: Record<string, never>; droppedNames: string[] };

export interface QuickAddProvider {
  getAssignees: () => string[];
  prefillNewTask: (f: TaskFields) => void;
  prefillNewMeeting: (f: MeetingFields) => void;
  createTask: (f: TaskFields) => void;
  createMeeting: (f: MeetingFields) => void;
  createIdea: (f: IdeaFields) => void;
  closeMeetingWithResult: (m: { id: string; summary: string }) => void;
}

const MOBILE_QUERY = "(max-width: 768px)";
const INPUT_STYLE = {
  flex: 1,
  padding: "7px 9px",
  border: "1px solid var(--line)",
  borderRadius: 6,
  fontFamily: "var(--sans)",
  fontSize: 13,
  background: "var(--paper-soft)",
  color: "var(--ink)",
} as const;

type Status = "idle" | "loading" | "clarify" | "idea-preview" | "task-preview" | "meeting-preview" | "answer" | "notes-preview";

export default function QuickAdd({
  provider,
  sheetOpen = false,
  onCloseSheet,
}: {
  provider: QuickAddProvider;
  // Своей плавающей кнопки у быстрого ввода на телефоне больше нет.
  //
  // Круглая «+» теперь заводит то, в каком разделе её нажали (слова
  // Кирилла 20.09.2026: «если в разделе задачи → ЗАДАЧУ, если в разделе
  // встречи → ВСТРЕЧУ и с мыслями так же»), а разбор фразы голосом
  // открывается строкой «Записать голосом» в меню шапки. Две круглых
  // кнопки в одном углу были бы ровно тем, чего он не хочет: одинаковые
  // на вид, разные по смыслу.
  sheetOpen?: boolean;
  onCloseSheet?: () => void;
}) {
  // Backed by useTrackerData's actions, passed straight in. (This used to
  // fall back to a window.trackerAPI global, which was how the old vanilla-JS
  // UI handed its state over; that UI is gone.)
  const api = provider;
  const ask = useAsk();

  // The desktop portal target is normally already in the DOM by the time
  // this mounts (it's part of the static markup rendered alongside it), so
  // this usually resolves on the very first check. But it's been reported
  // missing entirely in at least one mobile in-app browser — polling for a
  // short while instead of a single one-shot lookup means a late-arriving
  // element still gets picked up rather than leaving the bar silently gone
  // for the rest of the session.
  const [slot, setSlot] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.getElementById("quickAddSlot") : null,
  );
  useEffect(() => {
    if (slot) return;
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const el = document.getElementById("quickAddSlot");
      if (el || attempts > 50) {
        setSlot(el);
        clearInterval(interval);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [slot]);

  // Phones need a fundamentally different affordance than the desktop
  // toolbar bar: a thumb-reachable floating button that opens a bottom
  // sheet, rather than a bar the user has to scroll up to reach. Same form,
  // same logic underneath — only where/how it's presented differs.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [clarifyQuestion, setClarifyQuestion] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [ideaPreview, setIdeaPreview] = useState<IdeaFields | null>(null);
  const [taskPreview, setTaskPreview] = useState<TaskFields | null>(null);
  const [meetingPreview, setMeetingPreview] = useState<MeetingFields | null>(null);
  // Ошибки этой формы — всплывающее окно, а не строка под полем.
  //
  // До 23.09.2026 отказ рисовался прямо под строкой ввода и раздвигал
  // саму панель/лист снизу — растущий блок под полем при диктовке читался
  // как поломка формы, а не как объяснение. Правило Кирилла общее для
  // всего трекера: ошибка не должна расширять форму или блок, в котором
  // она возникла — она всплывает поверх. Текст не сбрасывает набранное:
  // окно закрывается, а строка ввода остаётся как была.
  function showError(message: string) {
    setStatus("idle");
    void ask.say({ title: "Не получилось", question: message });
  }
  // A question about the tracker gets answered by the server (see
  // /api/quick-add) — shown right here rather than sending the user to the
  // Telegram bot for it.
  const [answer, setAnswer] = useState("");
  // Action items extracted from dictated meeting notes — shown for review,
  // created only when the user confirms.
  const [notes, setNotes] = useState<{ summary: string; tasks: ExtractedTask[]; meeting: MatchedMeeting | null } | null>(null);

  // Voice input (browser-native, free, no server round trip). Dictation is
  // the whole interaction here: when you stop talking, the phrase goes
  // straight off to be parsed — no "Добавить" button to reach for
  // afterwards. Typed text still submits with Enter.
  const speech = useSpeechInput({
    onTranscript: setText,
    onDone: (finalText) => send(finalText, false),
    // Диктовка здесь — не удобство, а весь способ ввода: кнопка, которая
    // загорелась и ничего не сделала, оставляет человека ни с чем. Причина
    // пишется тем же местом, что и остальные отказы этой формы.
    onError: (code) => showError(speechErrorText(code)),
  });

  // Подпись микрофона: три состояния, и все три надо назвать. Молчащая
  // кнопка неотличима от сломанной — а здесь диктовка и есть весь ввод.
  const micLabel = speech.transcribing ? "Расшифровываю…" : speech.listening ? "Остановить запись" : "Надиктовать";

  function noteDropped(droppedNames: string[]) {
    if (droppedNames.length) {
      void ask.say({
        title: "Не все имена нашлись",
        question: "Не нашёл в списке исполнителей, пропустил: " + droppedNames.join(", "),
        note: "Добавить человека можно в карточке задачи — кнопкой «+» рядом с исполнителем.",
      });
    }
  }

  async function send(fullText: string, isClarifyFollowUp: boolean) {
    setStatus("loading");
    try {
      const assignees = api?.getAssignees() || [];
      const res = await fetch("/api/quick-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fullText, assignees }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Не удалось распознать");
        return;
      }
      handleItems((data.items as QuickAddItem[]) || [], isClarifyFollowUp);
    } catch {
      showError("Проблема с сетью");
    }
  }

  function handleItems(items: QuickAddItem[], isClarifyFollowUp: boolean) {
    // Whole message is a single unclear question — ask once, same loop
    // guard as the Telegram bot (comparing question text was too narrow in
    // practice; cap by round instead).
    if (items.length === 1 && items[0].tool === "ask_clarifying_question") {
      if (isClarifyFollowUp) {
        showError("Не смог разобрать фразу — попробуйте переформулировать");
        return;
      }
      setClarifyQuestion(items[0].input.question);
      setStatus("clarify");
      return;
    }

    // A clarifying question mixed into a multi-item batch can't be answered
    // (nowhere to hold several pending questions at once) — drop it and
    // handle the actionable items instead of derailing the whole message.
    const actionable = items.filter((it) => it.tool !== "ask_clarifying_question");
    if (!actionable.length) {
      showError("Не удалось разобрать фразу");
      return;
    }

    if (actionable.length === 1) {
      handleSingleItem(actionable[0]);
      return;
    }

    // Multiple items in one phrase ("заведи задачу X, две мысли Y и Z, и
    // встречу с Ивановым завтра в 15") — create everything directly instead
    // of opening a modal per item, same as the Telegram bot does.
    const created: string[] = [];
    const dropped: string[] = [];
    for (const it of actionable) {
      if (it.tool === "create_task") {
        api?.createTask(it.input);
        created.push("Задача: " + it.input.title);
      } else if (it.tool === "create_meeting") {
        api?.createMeeting(it.input);
        created.push("Встреча: " + it.input.title);
      } else if (it.tool === "create_idea") {
        api?.createIdea(it.input);
        created.push("Идея: " + it.input.text);
      } else if (it.tool === "manage_item") {
        created.push("(изменение существующего — сделайте кнопками в списке)");
      }
      dropped.push(...it.droppedNames);
    }
    void ask.say({
      title: "Создано",
      question: created.join("\n"),
      note: dropped.length ? "Не нашёл в списке исполнителей: " + dropped.join(", ") : undefined,
    });
    reset();
  }

  function handleSingleItem(item: QuickAddItem) {
    if (item.tool === "create_task") {
      // Desktop reviews/edits in the real modal (mouse+keyboard, plenty of
      // room). On a phone, reaching across that same multi-field form just
      // to confirm one parsed task is the opposite of "fast" — a compact
      // inline card with the essentials is enough, full editing is still a
      // tap away afterward via the task itself.
      if (isMobile) {
        setTaskPreview(item.input);
        setStatus("task-preview");
      } else {
        api?.prefillNewTask(item.input);
        noteDropped(item.droppedNames);
        reset();
      }
      return;
    }
    if (item.tool === "create_meeting") {
      if (isMobile) {
        setMeetingPreview(item.input);
        setStatus("meeting-preview");
      } else {
        api?.prefillNewMeeting(item.input);
        noteDropped(item.droppedNames);
        reset();
      }
      return;
    }
    if (item.tool === "create_idea") {
      setIdeaPreview(item.input);
      setStatus("idea-preview");
      return;
    }
    if (item.tool === "meeting_notes") {
      const tasks = item.input.tasks || [];
      const matched = item.input.meeting || null;
      // Nothing left to confirm only when there are neither action items
      // nor a meeting to close — otherwise the preview is still useful.
      if (!tasks.length && !matched) {
        setStatus("answer");
        setAnswer([item.input.summary || "", "Поручений в этом рассказе не нашёл."].filter(Boolean).join("\n\n"));
        return;
      }
      setNotes({ summary: item.input.summary || "", tasks, meeting: matched });
      setStatus("notes-preview");
      return;
    }
    if (item.tool === "answer_question") {
      setAnswer(item.input.answer || "");
      setStatus("answer");
      return;
    }
    if (item.tool === "cant_help") {
      showError("Это не похоже ни на задачу/встречу/мысль, ни на вопрос о делах");
      return;
    }
    if (item.tool === "manage_item") {
      showError("Изменить или удалить существующую задачу/встречу можно кнопками в списке — так надёжнее, чем текстом");
      return;
    }
    // Should not happen (ask_clarifying_question is filtered out before
    // reaching here) — fall back to a visible error rather than silence.
    showError("Неожиданный ответ сервера");
  }

  function reset() {
    setText("");
    setClarifyQuestion("");
    setClarifyAnswer("");
    setAnswer("");
    setNotes(null);
    setIdeaPreview(null);
    setTaskPreview(null);
    setMeetingPreview(null);
    setStatus("idle");
    if (isMobile) onCloseSheet?.();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    send(text.trim(), false);
  }

  function onClarifySubmit(e: FormEvent) {
    e.preventDefault();
    if (!clarifyAnswer.trim()) return;
    send(text + ". Уточнение: " + clarifyAnswer.trim(), true);
  }

  function confirmIdea() {
    if (!ideaPreview) return;
    api?.createIdea(ideaPreview);
    reset();
  }
  function confirmTask() {
    if (!taskPreview) return;
    api?.createTask(taskPreview);
    reset();
  }
  function confirmNotes() {
    if (!notes) return;
    for (const t of notes.tasks) {
      api?.createTask({ title: t.title, description: "", assignee: t.assignee, term: "short", deadline: t.deadline });
    }
    if (notes.meeting && notes.summary) {
      api?.closeMeetingWithResult({ id: notes.meeting.id, summary: notes.summary });
    }
    reset();
  }
  function confirmMeeting() {
    if (!meetingPreview) return;
    api?.createMeeting(meetingPreview);
    reset();
  }

  function renderFormBody(): ReactNode {
    return (
      <>
        {status !== "clarify" && status !== "idea-preview" && status !== "task-preview" && status !== "meeting-preview" && status !== "answer" && status !== "notes-preview" && (
          <form onSubmit={onSubmit} style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                status === "loading"
                  ? "Думаю…"
                  : speech.transcribing
                    ? "Расшифровываю сказанное…"
                    : speech.listening
                      ? "Говорите…"
                      : "Что добавить? Enter — добавить, 🎤 — надиктовать"
              }
              disabled={status === "loading"}
              style={INPUT_STYLE}
            />
            {speech.supported && (
              <button
                type="button"
                className={
                  "quick-add-mic-btn" + (speech.listening ? " listening" : "") + (speech.transcribing ? " transcribing" : "")
                }
                onClick={speech.toggle}
                disabled={status === "loading" || speech.transcribing}
                title={micLabel}
                aria-label={micLabel}
              >
                <Icon name={speech.transcribing ? "clock" : speech.listening ? "recording" : "mic"} size={16} />
              </button>
            )}
          </form>
        )}

        {status === "clarify" && (
          <form onSubmit={onClarifySubmit} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--ink)" }}>{clarifyQuestion}</span>
            <input type="text" autoFocus value={clarifyAnswer} onChange={(e) => setClarifyAnswer(e.target.value)} style={INPUT_STYLE} />
            <button className="btn btn-primary" type="submit" disabled={!clarifyAnswer.trim()}>
              Ответить
            </button>
            <button type="button" className="btn" onClick={reset}>
              Отмена
            </button>
          </form>
        )}

        {status === "idea-preview" && ideaPreview && (
          <div className="quick-add-preview">
            <div className="qap-row">
              <span style={{ color: "var(--ink-soft)" }}>Мысль{ideaPreview.important ? " (важно)" : ""}:</span>
              <span style={{ color: "var(--ink)" }}>{ideaPreview.text}</span>
            </div>
            <div className="qap-actions">
              <button className="btn btn-primary btn-small" onClick={confirmIdea}>Сохранить</button>
              <button className="btn btn-small" onClick={reset}>Отмена</button>
            </div>
          </div>
        )}

        {status === "task-preview" && taskPreview && (
          <div className="quick-add-preview">
            <div className="qap-row">
              <span style={{ color: "var(--ink-soft)" }}>Задача:</span>
              <span style={{ color: "var(--ink)" }}>{taskPreview.title}</span>
            </div>
            <div className="qap-row">
              {taskPreview.assignee && <span className="task-assignee">{taskPreview.assignee}</span>}
              {taskPreview.deadline && <span className="pill pill-date">{taskPreview.deadline}</span>}
            </div>
            <div className="qap-actions">
              <button className="btn btn-primary btn-small" onClick={confirmTask}>Сохранить</button>
              <button className="btn btn-small" onClick={reset}>Отмена</button>
            </div>
          </div>
        )}

        {status === "meeting-preview" && meetingPreview && (
          <div className="quick-add-preview">
            <div className="qap-row">
              <span style={{ color: "var(--ink-soft)" }}>Встреча:</span>
              <span style={{ color: "var(--ink)" }}>{meetingPreview.title}</span>
            </div>
            <div className="qap-row">
              {meetingPreview.date && <span className="pill pill-date">{meetingPreview.date}{meetingPreview.time ? ", " + meetingPreview.time : ""}</span>}
              {meetingPreview.participants.length > 0 && <span style={{ color: "var(--ink-soft)" }}>{meetingPreview.participants.join(", ")}</span>}
            </div>
            <div className="qap-actions">
              <button className="btn btn-primary btn-small" onClick={confirmMeeting}>Сохранить</button>
              <button className="btn btn-small" onClick={reset}>Отмена</button>
            </div>
          </div>
        )}

        {status === "notes-preview" && notes && (
          <div className="quick-add-preview">
            {notes.summary && (
              <div className="qap-row" style={{ display: "block", color: "var(--ink-soft)" }}>
                {notes.summary}
              </div>
            )}
            <div className="qap-row" style={{ display: "block" }}>
              Поручений: {notes.tasks.length}
            </div>
            {notes.meeting && (
              <div className="qap-row" style={{ display: "block", color: "var(--ink-soft)" }}>
                🗓 Встреча «{notes.meeting.title}» будет закрыта, итог запишу в её карточку
              </div>
            )}
            {notes.tasks.map((t, i) => (
              <div className="qap-row" key={i}>
                <span style={{ color: "var(--ink)" }}>{t.title}</span>
                {t.assignee && <span className="task-assignee">{t.assignee}</span>}
                {t.deadline && <span className="pill pill-date">{t.deadline}</span>}
              </div>
            ))}
            <div className="qap-actions">
              <button className="btn btn-primary btn-small" onClick={confirmNotes}>
                {notes.tasks.length ? "Создать все" : "Закрыть встречу"}
              </button>
              <button className="btn btn-small" onClick={reset}>
                Отмена
              </button>
            </div>
          </div>
        )}

        {status === "answer" && (
          <div className="quick-add-preview">
            <div className="qap-row" style={{ whiteSpace: "pre-wrap", display: "block" }}>
              {answer}
            </div>
            <div className="qap-actions">
              <button className="btn btn-small" onClick={reset}>
                Закрыть
              </button>
            </div>
          </div>
        )}

      </>
    );
  }

  if (isMobile) {
    // Лист снизу, открываемый снаружи. Portals straight to <body> since
    // it's position:fixed regardless of where in the DOM it lives.
    if (typeof document === "undefined" || !sheetOpen) return null;
    return createPortal(
      <div className="quick-add-sheet-backdrop" onClick={reset}>
        <div className="quick-add-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="quick-add-sheet-handle" />
          {renderFormBody()}
        </div>
      </div>,
      document.body,
    );
  }

  if (!slot) return null;
  return createPortal(<div style={{ width: "100%" }}>{renderFormBody()}</div>, slot);
}
