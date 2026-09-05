"use client";

import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import { useSpeechInput } from "@/hooks/useSpeechInput";
import { createPortal } from "react-dom";

export type TaskFields = {
  title: string;
  description: string;
  assignee: string;
  priority: "high" | "med";
  term: "short" | "long";
  deadline: string;
};
export type MeetingFields = { title: string; date: string; time: string; participants: string[] };
export type IdeaFields = { text: string; important: boolean };
// One action item pulled out of dictated meeting notes, awaiting confirmation.
export type ExtractedTask = { title: string; assignee: string; deadline: string; priority: "high" | "med" };

type QuickAddItem =
  | { tool: "create_task"; input: TaskFields; droppedNames: string[] }
  | { tool: "create_meeting"; input: MeetingFields; droppedNames: string[] }
  | { tool: "create_idea"; input: IdeaFields; droppedNames: string[] }
  | { tool: "ask_clarifying_question"; input: { question: string }; droppedNames: string[] }
  | { tool: "manage_item"; input: { action: string; itemType: string; query: string }; droppedNames: string[] }
  | { tool: "answer_question"; input: { answer?: string; query?: string }; droppedNames: string[] }
  | { tool: "meeting_notes"; input: { summary?: string; tasks?: ExtractedTask[] }; droppedNames: string[] }
  | { tool: "cant_help"; input: Record<string, never>; droppedNames: string[] };

export interface QuickAddProvider {
  getAssignees: () => string[];
  prefillNewTask: (f: TaskFields) => void;
  prefillNewMeeting: (f: MeetingFields) => void;
  createTask: (f: TaskFields) => void;
  createMeeting: (f: MeetingFields) => void;
  createIdea: (f: IdeaFields) => void;
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

type Status = "idle" | "loading" | "clarify" | "idea-preview" | "task-preview" | "meeting-preview" | "answer" | "notes-preview" | "error";

export default function QuickAdd({ provider }: { provider: QuickAddProvider }) {
  // Backed by useTrackerData's actions, passed straight in. (This used to
  // fall back to a window.trackerAPI global, which was how the old vanilla-JS
  // UI handed its state over; that UI is gone.)
  const api = provider;

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
  const [sheetOpen, setSheetOpen] = useState(false);

  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [clarifyQuestion, setClarifyQuestion] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [ideaPreview, setIdeaPreview] = useState<IdeaFields | null>(null);
  const [taskPreview, setTaskPreview] = useState<TaskFields | null>(null);
  const [meetingPreview, setMeetingPreview] = useState<MeetingFields | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  // A question about the tracker gets answered by the server (see
  // /api/quick-add) — shown right here rather than sending the user to the
  // Telegram bot for it.
  const [answer, setAnswer] = useState("");
  // Action items extracted from dictated meeting notes — shown for review,
  // created only when the user confirms.
  const [notes, setNotes] = useState<{ summary: string; tasks: ExtractedTask[] } | null>(null);

  // Voice input (browser-native, free, no server round trip). Dictation is
  // the whole interaction here: when you stop talking, the phrase goes
  // straight off to be parsed — no "Добавить" button to reach for
  // afterwards. Typed text still submits with Enter.
  const speech = useSpeechInput({
    onTranscript: setText,
    onDone: (finalText) => send(finalText, false),
  });

  function noteDropped(droppedNames: string[]) {
    if (droppedNames.length) {
      alert("Не нашёл в списке исполнителей, пропустил: " + droppedNames.join(", "));
    }
  }

  async function send(fullText: string, isClarifyFollowUp: boolean) {
    setStatus("loading");
    setErrorMessage("");
    try {
      const assignees = api?.getAssignees() || [];
      const res = await fetch("/api/quick-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fullText, assignees }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error || "Не удалось распознать");
        return;
      }
      handleItems((data.items as QuickAddItem[]) || [], isClarifyFollowUp);
    } catch {
      setStatus("error");
      setErrorMessage("Проблема с сетью");
    }
  }

  function handleItems(items: QuickAddItem[], isClarifyFollowUp: boolean) {
    // Whole message is a single unclear question — ask once, same loop
    // guard as the Telegram bot (comparing question text was too narrow in
    // practice; cap by round instead).
    if (items.length === 1 && items[0].tool === "ask_clarifying_question") {
      if (isClarifyFollowUp) {
        setStatus("error");
        setErrorMessage("Не смог разобрать фразу — попробуйте переформулировать");
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
      setStatus("error");
      setErrorMessage("Не удалось разобрать фразу");
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
    let msg = "Создано:\n" + created.join("\n");
    if (dropped.length) msg += "\n\n⚠ Не нашёл в списке исполнителей: " + dropped.join(", ");
    alert(msg);
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
      if (!tasks.length) {
        setStatus("answer");
        setAnswer([item.input.summary || "", "Поручений в этом рассказе не нашёл."].filter(Boolean).join("\n\n"));
        return;
      }
      setNotes({ summary: item.input.summary || "", tasks });
      setStatus("notes-preview");
      return;
    }
    if (item.tool === "answer_question") {
      setAnswer(item.input.answer || "");
      setStatus("answer");
      return;
    }
    if (item.tool === "cant_help") {
      setStatus("error");
      setErrorMessage("Это не похоже ни на задачу/встречу/мысль, ни на вопрос о делах");
      return;
    }
    if (item.tool === "manage_item") {
      setStatus("error");
      setErrorMessage("Изменить или удалить существующую задачу/встречу можно кнопками в списке — так надёжнее, чем текстом");
      return;
    }
    // Should not happen (ask_clarifying_question is filtered out before
    // reaching here) — fall back to a visible error rather than silence.
    setStatus("error");
    setErrorMessage("Неожиданный ответ сервера");
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
    setErrorMessage("");
    setStatus("idle");
    if (isMobile) setSheetOpen(false);
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
      api?.createTask({ title: t.title, description: "", assignee: t.assignee, priority: t.priority, term: "short", deadline: t.deadline });
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
                status === "loading" ? "Думаю…" : speech.listening ? "Говорите…" : "Что добавить? Enter — добавить, 🎤 — надиктовать"
              }
              disabled={status === "loading"}
              style={INPUT_STYLE}
            />
            {speech.supported && (
              <button
                type="button"
                className={"quick-add-mic-btn" + (speech.listening ? " listening" : "")}
                onClick={speech.toggle}
                disabled={status === "loading"}
                title={speech.listening ? "Остановить запись" : "Надиктовать"}
                aria-label={speech.listening ? "Остановить запись" : "Надиктовать"}
              >
                {speech.listening ? "⏺" : "🎤"}
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
              {taskPreview.priority === "high" && <span className="pill pill-high">Высокий</span>}
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
            {notes.tasks.map((t, i) => (
              <div className="qap-row" key={i}>
                <span style={{ color: "var(--ink)" }}>{t.title}</span>
                {t.assignee && <span className="task-assignee">{t.assignee}</span>}
                {t.deadline && <span className="pill pill-date">{t.deadline}</span>}
                {t.priority === "high" && <span className="pill pill-high">Высокий</span>}
              </div>
            ))}
            <div className="qap-actions">
              <button className="btn btn-primary btn-small" onClick={confirmNotes}>
                Создать все
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

        {status === "error" && (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--high)" }}>
            {errorMessage} — <button className="btn-ghost" style={{ textDecoration: "underline" }} onClick={reset}>ок</button>
          </div>
        )}
      </>
    );
  }

  if (isMobile) {
    // Floating, thumb-reachable capture button + bottom sheet — reachable
    // from anywhere on the page without scrolling to the toolbar. Portals
    // straight to <body> since it's position:fixed regardless of where in
    // the DOM it lives.
    if (typeof document === "undefined") return null;
    return createPortal(
      <>
        <button
          type="button"
          className="quick-add-fab"
          onClick={() => setSheetOpen(true)}
          aria-label="Добавить задачу, встречу или мысль"
        >
          +
        </button>
        {sheetOpen && (
          <div className="quick-add-sheet-backdrop" onClick={reset}>
            <div className="quick-add-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="quick-add-sheet-handle" />
              {renderFormBody()}
            </div>
          </div>
        )}
      </>,
      document.body,
    );
  }

  if (!slot) return null;
  return createPortal(<div style={{ width: "100%" }}>{renderFormBody()}</div>, slot);
}
