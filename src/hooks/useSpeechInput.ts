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
  abort?: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e?: { error?: string }) => void) | null;
  // «Микрофон открылся». Единственное событие, по которому видно, что
  // распознавание действительно началось, — см. сторожевой таймер ниже.
  onaudiostart?: (() => void) | null;
};

type SpeechCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

// Сколько ждать, пока микрофон откроется, прежде чем признать, что
// распознавание не запустилось. Четыре секунды — с запасом: в обычном
// браузере onaudiostart приходит за доли секунды, вместе с разрешением.
const START_TIMEOUT_MS = 4000;

// Почему не получилось — словами, которые можно показать человеку.
//
// Коды взяты из спецификации Web Speech API. Отдельно стоит
// service-not-allowed: именно его (или молчание вместо любого события)
// даёт встроенный браузер мессенджера. Кирилл 20.09.2026: «зажатый
// микрофон с мини-приложения в телеге, включенного с ПК, не работает» —
// кнопка переходила в состояние записи и оставалась в нём навсегда,
// потому что ни onresult, ни onend, ни onerror не приходили вовсе.
export function speechErrorText(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed" || code === "start-timeout") {
    return "Диктовка здесь недоступна: её не пускает окно, в котором открыт трекер. Внутри мессенджера распознавание речи работает не всегда — откройте трекер в браузере или продиктуйте сообщение боту в чате, он расшифрует его сам.";
  }
  if (code === "audio-capture") return "Микрофон не найден. Проверьте, подключён ли он и не занят ли другой программой.";
  if (code === "network") return "Распознавание речи не отвечает — нет связи с его сервисом. Попробуйте ещё раз или наберите текст.";
  return "Не получилось распознать речь. Попробуйте ещё раз или наберите текст.";
}

export function useSpeechInput({
  onTranscript,
  onDone,
  onError,
}: {
  // Fires continuously while dictating (interim results included), so the
  // caller can show the text taking shape in its own field.
  onTranscript: (text: string) => void;
  // Fires once when dictation ends, with the final text — the caller decides
  // whether that just leaves the text in a field or acts on it immediately.
  onDone?: (text: string) => void;
  // Не получилось. Получает код — текст для человека собирает
  // speechErrorText, чтобы одно объяснение было у всех кнопок сразу.
  // Молчание («no-speech») сюда не приходит: человеку, который передумал
  // говорить, объяснять нечего.
  onError?: (code: string) => void;
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
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onDoneRef.current = onDone;
    onErrorRef.current = onError;
  }, [onTranscript, onDone, onError]);

  // Сторож на запуск. Живёт рядом с самим распознаванием, а не в кнопке:
  // залипнуть может любая кнопка, которая им пользуется.
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearWatchdog = () => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  };

  // Отпустить микрофон, когда компонент ушёл с экрана: иначе распознавание
  // остаётся жить и держит микрофон открытым без единой кнопки, которой
  // его остановить.
  useEffect(() => {
    return () => {
      clearWatchdog();
      const running = recognitionRef.current;
      recognitionRef.current = null;
      if (running) (running.abort ?? running.stop).call(running);
    };
  }, []);

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

    // Всё, что гасит кнопку, ходит через одну дверь: иначе состояние
    // «идёт запись» снимается в трёх местах и в четвёртом забывается —
    // ровно то, из-за чего микрофон оставался зажатым.
    const finish = (errorCode?: string) => {
      clearWatchdog();
      const wasRunning = recognitionRef.current === recognition;
      recognitionRef.current = null;
      setListening(false);
      if (!wasRunning) return;
      if (errorCode) {
        if (errorCode !== "no-speech" && errorCode !== "aborted") onErrorRef.current?.(errorCode);
        return;
      }
      const text = transcriptRef.current.trim();
      if (text) onDoneRef.current?.(text);
    };

    recognition.onresult = (e) => {
      // Результат пришёл — значит запустилось, и сторож больше не нужен.
      clearWatchdog();
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      transcriptRef.current = transcript;
      onTranscriptRef.current(transcript);
    };
    recognition.onaudiostart = () => clearWatchdog();
    recognition.onend = () => finish();
    recognition.onerror = (e) => finish(e?.error || "unknown");

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // start() бросает, если распознавание уже идёт, — и бросает молча в
      // окружении, где его вовсе нет, хотя конструктор есть.
      finish("start-timeout");
      return;
    }
    setListening(true);
    // Микрофон не открылся и ошибки не было: встроенный браузер
    // мессенджера отвечает на start() молчанием. Для человека это
    // «нажал — и ничего», поэтому отвечаем за него мы.
    watchdogRef.current = setTimeout(() => {
      if (recognitionRef.current !== recognition) return;
      // Сначала объявляем результат, потом глушим. Обратный порядок терял
      // объяснение: abort() синхронно зовёт onend, тот проходит через ту
      // же дверь первым и закрывает её за собой, а наш вызов с причиной
      // приходит к уже закрытой.
      finish("start-timeout");
      try {
        (recognition.abort ?? recognition.stop).call(recognition);
      } catch {
        // Нечего останавливать — значит и не начиналось.
      }
    }, START_TIMEOUT_MS);
  }, []);

  return { supported, listening, toggle };
}
