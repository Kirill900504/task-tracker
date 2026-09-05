"use client";

// Dictate-into-this-field button, sitting next to a text input or textarea.
// Whatever was already typed is kept: dictation appends to it, so you can
// start typing, finish by voice, or dictate twice in a row.
//
// Renders nothing at all where the browser has no speech recognition, rather
// than offering a button that would do nothing.
import { useRef } from "react";
import { useSpeechInput } from "@/hooks/useSpeechInput";

export default function MicButton({
  value,
  onChange,
  onDone,
  title = "Надиктовать",
}: {
  value: string;
  onChange: (text: string) => void;
  // Optional: act on the finished text the moment dictation stops (the
  // ideas field saves the thought straight away rather than waiting for a
  // second click). Receives the full field value, dictation appended.
  onDone?: (text: string) => void;
  title?: string;
}) {
  // Captured when dictation starts so each interim result replaces only the
  // dictated part, not the text that was already in the field.
  const baseRef = useRef("");
  const combine = (text: string) => (baseRef.current ? `${baseRef.current} ${text}` : text);
  const speech = useSpeechInput({
    onTranscript: (text) => onChange(combine(text)),
    onDone: onDone ? (text) => onDone(combine(text)) : undefined,
  });

  if (!speech.supported) return null;

  return (
    <button
      type="button"
      className={"field-mic-btn" + (speech.listening ? " listening" : "")}
      title={speech.listening ? "Остановить запись" : title}
      aria-label={speech.listening ? "Остановить запись" : title}
      onClick={() => {
        if (!speech.listening) baseRef.current = value.trim();
        speech.toggle();
      }}
    >
      {speech.listening ? "⏺" : "🎤"}
    </button>
  );
}
