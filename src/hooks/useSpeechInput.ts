"use client";

// Диктовка, у которой два пути, и оба ведут в одно и то же поле.
//
// Первый — Web Speech API, тот, что «встроен в браузер»: мгновенный,
// бесплатный, с текстом, который набирается прямо по ходу речи. Встроен он,
// впрочем, только по виду — Chrome возит звук на распознавание в сервис
// Google, и когда до того сервиса нет связи, диктовка не работает вовсе.
// Так и случилось 21.09.2026: «не работает возможность записывать
// диктовкой ни у меня ни у Витковского», кнопка отвечала «нет связи с его
// сервисом», и чинить в трекере было нечего — ломалось не здесь.
//
// Отсюда второй путь, целиком наш: браузер пишет звук сам, а расшифровывает
// его /api/speech — тем же Whisper, который давно разбирает голосовые из
// мессенджеров. Он медленнее (несколько секунд, а на первой записи после
// простоя — до двадцати, пока функция поднимается) и ошибается чаще, и
// поэтому он именно запасной: включается, когда первый отказал, и только на
// эту вкладку, чтобы вернувшийся Google снова забрал работу себе.
//
// Живёт всё это здесь, а не в кнопке, по той же причине, по какой здесь
// живёт сторож на запуск: кнопок микрофона в трекере семь, и второй путь
// должен был появиться у всех сразу.
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_MS, startPcmRecording, transcribeOnServer, type PcmRecording } from "@/lib/dictation";

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

// Можем ли мы записать звук сами. Этого достаточно для второго пути, и
// поэтому кнопка микрофона теперь есть и там, где Web Speech нет вовсе
// (Firefox): раньше она там просто не рисовалась.
function canRecord(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  return !!(w.AudioContext || w.webkitAudioContext) && !!navigator.mediaDevices?.getUserMedia;
}

// Сколько ждать, пока микрофон откроется, прежде чем признать, что
// распознавание не запустилось. Четыре секунды — с запасом: в обычном
// браузере onaudiostart приходит за доли секунды, вместе с разрешением.
const START_TIMEOUT_MS = 4000;

// Память о том, что первый путь сегодня не работает. Именно sessionStorage,
// а не localStorage: сервис Google отваливается и возвращается, а он
// заметно точнее нашего Whisper — запомнив отказ навсегда, мы бы навсегда и
// остались на худшем распознавании. Вкладка — правильный срок: новый запуск
// трекера снова пробует лучший путь.
const FALLBACK_FLAG = "rokas:dictation-fallback";

// Отказы, после которых имеет смысл переключиться на свой путь. Общее у них
// одно: до сервиса распознавания не достучались. «Микрофона нет» и «не дали
// доступ» сюда не входят — там второй путь упрётся ровно в то же.
const SERVICE_FAILURE = new Set(["network", "service-not-allowed", "start-timeout"]);

function fallbackRemembered(): boolean {
  try {
    return sessionStorage.getItem(FALLBACK_FLAG) === "1";
  } catch {
    // Приватное окно или запрет на хранилище: тогда переключение живёт
    // ровно до перезагрузки страницы, и это тоже приемлемо.
    return false;
  }
}

function rememberFallback() {
  try {
    sessionStorage.setItem(FALLBACK_FLAG, "1");
  } catch {
    /* см. выше */
  }
}

// Почему не получилось — словами, которые можно показать человеку.
//
// Коды взяты из спецификации Web Speech API, плюс несколько своих — те,
// что может вернуть второй путь. Отдельно стоит service-not-allowed:
// именно его (или молчание вместо любого события) даёт встроенный браузер
// мессенджера. Кирилл 20.09.2026: «зажатый микрофон с мини-приложения в
// телеге, включенного с ПК, не работает» — кнопка переходила в состояние
// записи и оставалась в нём навсегда, потому что ни onresult, ни onend, ни
// onerror не приходили вовсе.
export function speechErrorText(code: string): string {
  // Не отказ, а пересадка: первый путь отвалился, второй готов. Сказать об
  // этом надо обязательно — человек уже наговорил фразу в пустоту, и
  // молчаливое «нажмите ещё раз» он прочитает как поломку.
  if (code === "switched-to-server") {
    return "Сервис распознавания речи, которым пользуется браузер, не отвечает. Дальше расшифровывать буду сама — нажмите микрофон ещё раз и говорите. Первая запись займёт до двадцати секунд, следующие — пару секунд.";
  }
  if (code === "not-allowed" || code === "service-not-allowed" || code === "start-timeout") {
    return "Диктовка здесь недоступна: её не пускает окно, в котором открыт трекер. Внутри мессенджера распознавание речи работает не всегда — откройте трекер в браузере или продиктуйте сообщение боту в чате, он расшифрует его сам.";
  }
  if (code === "audio-capture") return "Микрофон не найден. Проверьте, подключён ли он и не занят ли другой программой.";
  if (code === "network") return "Распознавание речи не отвечает — нет связи с его сервисом. Попробуйте ещё раз или наберите текст.";
  if (code === "server") return "Не получилось расшифровать запись — трекер не смог её разобрать. Попробуйте ещё раз или наберите текст.";
  if (code === "silence") return "Ничего не услышала. Проверьте, тот ли микрофон выбран, и попробуйте ещё раз.";
  return "Не получилось распознать речь. Попробуйте ещё раз или наберите текст.";
}

export function useSpeechInput({
  onTranscript,
  onDone,
  onError,
}: {
  // Fires continuously while dictating (interim results included), so the
  // caller can show the text taking shape in its own field. На втором пути
  // промежуточных результатов нет — он зовёт это один раз, готовым текстом,
  // чтобы поле заполнялось одинаково независимо от того, кто слушал.
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
  const [recordable] = useState(() => canRecord());
  const [browserSpeech] = useState(() => !!getCtor());
  const [listening, setListening] = useState(false);
  // Запись кончилась, текста ещё нет: секунды ожидания второго пути. Без
  // этого состояния кнопка гаснет, и человек уверен, что диктовка пропала.
  const [transcribing, setTranscribing] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingRef = useRef<PcmRecording | null>(null);
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
  // его остановить. Запись — то же самое, и ещё нагляднее: у неё горит
  // индикатор записи во вкладке.
  useEffect(() => {
    return () => {
      clearWatchdog();
      const running = recognitionRef.current;
      recognitionRef.current = null;
      if (running) (running.abort ?? running.stop).call(running);
      const recording = recordingRef.current;
      recordingRef.current = null;
      recording?.cancel();
    };
  }, []);

  // ВТОРОЙ ПУТЬ: пишем сами, расшифровываем у себя.
  const stopAndSend = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    recordingRef.current = null;
    const pcm = recording.stop();
    setListening(false);
    // Треть секунды — это не речь, а промах по кнопке; будить ради него
    // модель незачем, и маршрут такую запись всё равно вернёт пустой.
    if (pcm.length < 16000 * 0.3) {
      onErrorRef.current?.("silence");
      return;
    }
    setTranscribing(true);
    try {
      const text = await transcribeOnServer(pcm);
      if (!text) {
        onErrorRef.current?.("silence");
        return;
      }
      onTranscriptRef.current(text);
      onDoneRef.current?.(text);
    } catch (e) {
      onErrorRef.current?.(e instanceof Error ? e.message : "server");
    } finally {
      setTranscribing(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      // onAutoStop: минута кончилась. Отправляем то, что записано, а не
      // выбрасываем — потерять наговоренное хуже, чем обрезать.
      recordingRef.current = await startPcmRecording(() => void stopAndSend());
      setListening(true);
    } catch (e) {
      setListening(false);
      onErrorRef.current?.(e instanceof Error ? e.message : "audio-capture");
    }
  }, [stopAndSend]);

  // ПЕРВЫЙ ПУТЬ: распознавание браузера.
  const startRecognition = useCallback(() => {
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
        if (errorCode === "no-speech" || errorCode === "aborted") return;
        // Сервис не ответил, а записать и разобрать сами мы можем —
        // значит это не отказ, а пересадка на второй путь. Запоминаем её
        // на вкладку, чтобы следующее нажатие не тратило те же секунды
        // впустую, и говорим об этом словами.
        if (SERVICE_FAILURE.has(errorCode) && recordable) {
          rememberFallback();
          onErrorRef.current?.("switched-to-server");
          return;
        }
        onErrorRef.current?.(errorCode);
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
  }, [recordable]);

  const toggle = useCallback(() => {
    if (recordingRef.current) {
      void stopAndSend();
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    // Пока расшифровывается предыдущая фраза, второе нажатие ничего не
    // начинает: два ответа в одно поле перепишут друг друга.
    if (transcribing) return;
    const useServer = recordable && (!browserSpeech || fallbackRemembered());
    if (useServer) void startRecording();
    else startRecognition();
  }, [browserSpeech, recordable, startRecognition, startRecording, stopAndSend, transcribing]);

  return {
    // Кнопка есть, если хоть один путь возможен.
    supported: browserSpeech || recordable,
    listening,
    transcribing,
    // Сколько всего можно говорить за раз на втором пути — для подписей.
    maxMs: MAX_RECORDING_MS,
    toggle,
  };
}
