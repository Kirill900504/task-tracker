"use client";

import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

type TaskFields = {
  title: string;
  description: string;
  assignee: string;
  priority: "high" | "med";
  term: "short" | "long";
  deadline: string;
};
type MeetingFields = { title: string; date: string; time: string; participants: string[] };
type IdeaFields = { text: string; important: boolean };

type QuickAddResult =
  | { tool: "create_task"; input: TaskFields; droppedNames: string[] }
  | { tool: "create_meeting"; input: MeetingFields; droppedNames: string[] }
  | { tool: "create_idea"; input: IdeaFields; droppedNames: string[] }
  | { tool: "ask_clarifying_question"; input: { question: string }; droppedNames: string[] }
  | { tool: "cant_help"; input: Record<string, never>; droppedNames: string[] };

declare global {
  interface Window {
    trackerAPI?: {
      getAssignees: () => string[];
      prefillNewTask: (f: TaskFields) => void;
      prefillNewMeeting: (f: MeetingFields) => void;
      createIdea: (f: IdeaFields) => void;
    };
  }
}

type Status = "idle" | "loading" | "clarify" | "idea-preview" | "error";

export default function QuickAdd() {
  // The portal target is part of the static markup rendered alongside this
  // component, so it already exists in the DOM by the time this runs on the
  // client — a lazy initializer avoids an extra effect + render pass.
  const [slot] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" ? document.getElementById("quickAddSlot") : null,
  );
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [clarifyQuestion, setClarifyQuestion] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [ideaPreview, setIdeaPreview] = useState<IdeaFields | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  function noteDropped(droppedNames: string[]) {
    if (droppedNames.length) {
      alert("Не нашёл в списке исполнителей, пропустил: " + droppedNames.join(", "));
    }
  }

  async function send(fullText: string, isClarifyFollowUp: boolean) {
    setStatus("loading");
    setErrorMessage("");
    try {
      const assignees = window.trackerAPI?.getAssignees() || [];
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
      handleResult(data as QuickAddResult, isClarifyFollowUp);
    } catch {
      setStatus("error");
      setErrorMessage("Проблема с сетью");
    }
  }

  function handleResult(result: QuickAddResult, isClarifyFollowUp: boolean) {
    if (result.tool === "ask_clarifying_question") {
      // Loop guard: allow at most one clarifying round-trip. Comparing the
      // question text was too narrow in practice (the model phrases repeat
      // asks differently, so an exact match rarely fires) — cap by round
      // instead, matching the same fix applied to the Telegram bot.
      if (isClarifyFollowUp) {
        setStatus("error");
        setErrorMessage("Не смог разобрать фразу — попробуйте переформулировать");
        return;
      }
      setClarifyQuestion(result.input.question);
      setStatus("clarify");
      return;
    }
    if (result.tool === "create_task") {
      window.trackerAPI?.prefillNewTask(result.input);
      noteDropped(result.droppedNames);
      reset();
      return;
    }
    if (result.tool === "create_meeting") {
      window.trackerAPI?.prefillNewMeeting(result.input);
      noteDropped(result.droppedNames);
      reset();
      return;
    }
    if (result.tool === "create_idea") {
      setIdeaPreview(result.input);
      setStatus("idea-preview");
      return;
    }
    if (result.tool === "cant_help") {
      setStatus("error");
      setErrorMessage("Это не похоже на задачу/встречу/идею — умею создавать только их");
      return;
    }
    // Should not happen — fall back to a visible error rather than silence.
    setStatus("error");
    setErrorMessage("Неожиданный ответ сервера");
  }

  function reset() {
    setText("");
    setClarifyQuestion("");
    setClarifyAnswer("");
    setIdeaPreview(null);
    setErrorMessage("");
    setStatus("idle");
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
    window.trackerAPI?.createIdea(ideaPreview);
    reset();
  }

  if (!slot) return null;

  return createPortal(
    <div style={{ width: "100%" }}>
      {status !== "clarify" && status !== "idea-preview" && (
        <form onSubmit={onSubmit} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Что добавить? Например: завтра позвонить Сергею"
            disabled={status === "loading"}
            style={{
              flex: 1,
              padding: "7px 9px",
              border: "1px solid var(--line)",
              borderRadius: 6,
              fontFamily: "var(--sans)",
              fontSize: 13,
              background: "var(--paper-soft)",
              color: "var(--ink)",
            }}
          />
          <button className="btn btn-primary" type="submit" disabled={status === "loading" || !text.trim()}>
            {status === "loading" ? "Думаю…" : "Добавить"}
          </button>
        </form>
      )}

      {status === "clarify" && (
        <form onSubmit={onClarifySubmit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--ink)" }}>{clarifyQuestion}</span>
          <input
            type="text"
            autoFocus
            value={clarifyAnswer}
            onChange={(e) => setClarifyAnswer(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 10px",
              border: "1px solid var(--accent)",
              borderRadius: 6,
              fontFamily: "var(--sans)",
              fontSize: 13,
              background: "var(--paper-soft)",
              color: "var(--ink)",
            }}
          />
          <button className="btn btn-primary" type="submit" disabled={!clarifyAnswer.trim()}>
            Ответить
          </button>
          <button type="button" className="btn" onClick={reset}>
            Отмена
          </button>
        </form>
      )}

      {status === "idea-preview" && ideaPreview && (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            Мысль{ideaPreview.important ? " (важно)" : ""}:
          </span>
          <span style={{ fontSize: 13, color: "var(--ink)", flex: 1 }}>{ideaPreview.text}</span>
          <button className="btn btn-primary btn-small" onClick={confirmIdea}>
            Сохранить
          </button>
          <button className="btn btn-small" onClick={reset}>
            Отмена
          </button>
        </div>
      )}

      {status === "error" && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--high)" }}>
          {errorMessage} — <button className="btn-ghost" style={{ textDecoration: "underline" }} onClick={reset}>ок</button>
        </div>
      )}
    </div>,
    slot,
  );
}
