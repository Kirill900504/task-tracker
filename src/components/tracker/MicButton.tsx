"use client";

// Dictate-into-this-field button, sitting next to a text input or textarea.
// Whatever was already typed is kept: dictation appends to it, so you can
// start typing, finish by voice, or dictate twice in a row.
//
// Renders nothing at all where the browser has no speech recognition, rather
// than offering a button that would do nothing.
import { useRef } from "react";
import { speechErrorText, useSpeechInput } from "@/hooks/useSpeechInput";
import { useAsk } from "@/components/Ask";
import Icon from "./Icon";

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
  const ask = useAsk();
  const speech = useSpeechInput({
    onTranscript: (text) => onChange(combine(text)),
    onDone: onDone ? (text) => onDone(combine(text)) : undefined,
    // Отказ обязан говорить. Раньше он молчал, и снаружи это выглядело
    // так: кнопка загорелась и осталась гореть — «зажатый микрофон» из
    // слов Кирилла 20.09.2026. Молчащая кнопка неотличима от сломанной,
    // а от неё вдобавок непонятно, что делать; теперь она называет
    // причину и путь в обход (см. speechErrorText).
    onError: (code) => void ask.say({ title: "Диктовка не включилась", question: speechErrorText(code) }),
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
      <Icon name={speech.listening ? "recording" : "mic"} size={16} />
    </button>
  );
}
