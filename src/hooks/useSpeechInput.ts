"use client";

// Browser-native dictation (Web Speech API): free, no server round trip, no
// audio ever leaves the browser's own speech service. Extracted from
// QuickAdd so the task/meeting forms can dictate into their fields too.
//
// Feature-detected: Firefox and older browsers simply don't get a mic button
// rather than being shown one that fails.
import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API still has no standard ambient type in TS's DOM lib and
// ships under a vendor prefix in the browsers that do support it — typed
// loosely on purpose, this is a real browser-compat boundary.
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type SpeechCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

export function useSpeechInput({
  onTranscript,
  onDone,
}: {
  // Fires continuously while dictating (interim results included), so the
  // caller can show the text taking shape in its own field.
  onTranscript: (text: string) => void;
  // Fires once when dictation ends, with the final text — the caller decides
  // whether that just leaves the text in a field or acts on it immediately.
  onDone?: (text: string) => void;
}) {
  const [supported] = useState(() => !!getCtor());
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  // onresult/onend fire from a long-lived recognition object that outlives
  // the render it was created in, so the callbacks are reached through refs
  // (kept current by the effect below) rather than captured in a closure.
  const onTranscriptRef = useRef(onTranscript);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onDoneRef.current = onDone;
  }, [onTranscript, onDone]);

  const toggle = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const Ctor = getCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "ru-RU";
    recognition.interimResults = true;
    recognition.continuous = false;
    transcriptRef.current = "";
    recognition.onresult = (e) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      transcriptRef.current = transcript;
      onTranscriptRef.current(transcript);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      const text = transcriptRef.current.trim();
      if (text) onDoneRef.current?.(text);
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, []);

  return { supported, listening, toggle };
}
