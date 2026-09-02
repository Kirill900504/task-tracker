"use client";

import { useState, useEffect, type FormEvent } from "react";
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

type QuickAddItem =
  | { tool: "create_task"; input: TaskFields; droppedNames: string[] }
  | { tool: "create_meeting"; input: MeetingFields; droppedNames: string[] }
  | { tool: "create_idea"; input: IdeaFields; droppedNames: string[] }
  | { tool: "ask_clarifying_question"; input: { question: string }; droppedNames: string[] }
  | { tool: "manage_item"; input: { action: string; itemType: string; query: string }; droppedNames: string[] }
  | { tool: "cant_help"; input: Record<string, never>; droppedNames: string[] };

declare global {
  interface Window {
    trackerAPI?: {
      getAssignees: () => string[];
      prefillNewTask: (f: TaskFields) => void;
      prefillNewMeeting: (f: MeetingFields) => void;
      createTask: (f: TaskFields) => void;
      createMeeting: (f: MeetingFields) => void;
      createIdea: (f: IdeaFields) => void;
    };
  }
}

type Status = "idle" | "loading" | "clarify" | "idea-preview" | "error";

export default function QuickAdd() {
  // The portal target is normally already in the DOM by the time this
  // mounts (it's part of the static markup rendered alongside it), so this
  // usually resolves on the very first check. But it's been reported
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
        window.trackerAPI?.createTask(it.input);
        created.push("Задача: " + it.input.title);
      } else if (it.tool === "create_meeting") {
        window.trackerAPI?.createMeeting(it.input);
        created.push("Встреча: " + it.input.title);
      } else if (it.tool === "create_idea") {
        window.trackerAPI?.createIdea(it.input);
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
      window.trackerAPI?.prefillNewTask(item.input);
      noteDropped(item.droppedNames);
      reset();
      return;
    }
    if (item.tool === "create_meeting") {
      window.trackerAPI?.prefillNewMeeting(item.input);
      noteDropped(item.droppedNames);
      reset();
      return;
    }
    if (item.tool === "create_idea") {
      setIdeaPreview(item.input);
      setStatus("idea-preview");
      return;
    }
    if (item.tool === "cant_help") {
      setStatus("error");
      setErrorMessage("Это не похоже на задачу/встречу/идею — умею создавать только их");
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
