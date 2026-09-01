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
  | { tool: "create_task"; input: TaskFields }
  | { tool: "create_meeting"; input: MeetingFields }
  | { tool: "create_idea"; input: IdeaFields }
  | { tool: "ask_clarifying_question"; input: { question: string } };

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

  async function send(fullText: string) {
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
      handleResult(data as QuickAddResult, fullText);
    } catch {
      setStatus("error");
      setErrorMessage("Проблема с сетью");
    }
  }

  function handleResult(result: QuickAddResult, fullText: string) {
    if (result.tool === "ask_clarifying_question") {
      setClarifyQuestion(result.input.question);
      setStatus("clarify");
      return;
    }
    if (result.tool === "create_task") {
      window.trackerAPI?.prefillNewTask(result.input);
      reset();
      return;
    }
    if (result.tool === "create_meeting") {
      window.trackerAPI?.prefillNewMeeting(result.input);
      reset();
      return;
    }
    if (result.tool === "create_idea") {
      setIdeaPreview(result.input);
      setStatus("idea-preview");
      return;
    }
    // Should not happen — fall back to showing the raw text as an error.
    setStatus("error");
    setErrorMessage("Неожиданный ответ: " + fullText);
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
    send(text.trim());
  }

  function onClarifySubmit(e: FormEvent) {
    e.preventDefault();
    if (!clarifyAnswer.trim()) return;
    send(text + ". Уточнение: " + clarifyAnswer.trim());
  }

  function confirmIdea() {
    if (!ideaPreview) return;
    window.trackerAPI?.createIdea(ideaPreview);
    reset();
  }

  if (!slot) return null;

  return createPortal(
    <div
      style={{
        borderBottom: "1px solid var(--line)",
        background: "var(--paper)",
        padding: "10px 28px",
      }}
    >
      {status !== "clarify" && status !== "idea-preview" && (
        <form onSubmit={onSubmit} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Что нужно добавить? Например: завтра позвонить Сергею"
            disabled={status === "loading"}
            style={{
              flex: 1,
              padding: "8px 10px",
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
