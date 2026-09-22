"use client";

// Запасная диктовка: записать голос самим и расшифровать у себя.
//
// Первый путь у диктовки другой — Web Speech API, тот, что встроен в
// браузер. Он быстрее и точнее, но «встроенный» он только по виду: Chrome
// возит звук на распознавание в сервис Google. 21.09.2026 до этого сервиса
// не достучались ни Кирилл, ни Витковский — кнопка честно ответила «нет
// связи с его сервисом», и починить это в трекере было нельзя, потому что
// ломалось не в трекере. Отсюда второй путь, целиком наш: микрофон читает
// браузер, расшифровывает /api/speech тем же Whisper, что и голосовые из
// мессенджеров.
//
// Записывается СРАЗУ то, что нужно на том конце: моно, 16 кГц, знаковые
// 16-битные отсчёты. Контейнера нет вовсе — и это главное решение здесь.
// Очевидный путь (MediaRecorder) отдаёт в Chrome WebM с Opus внутри, то
// есть к расшифровке пришлось бы добавить разбор чужого контейнера и
// второй звуковой кодек в ту же функцию — ради звука, который браузер
// умеет отдать уже готовым.

// Столько же, сколько принимает маршрут. Запись останавливается сама:
// забытый включённым микрофон иначе доедет до предела и пропадёт целиком,
// а это худший из возможных ответов на «я всё сказал».
export const MAX_RECORDING_MS = 60_000;

const TARGET_RATE = 16000;
// Размер куска, которым ScriptProcessor отдаёт звук. 4096 отсчётов — это
// четверть секунды на нашей частоте: достаточно редко, чтобы не мешать
// отрисовке, и достаточно часто, чтобы ничего не терялось.
const BUFFER_SIZE = 4096;

// Экспортированы обе — не ради переиспользования, а ради проверки:
// ошибка здесь не падает и не видна, она приезжает на тот конец тихой
// кашей вместо речи, а Whisper на каше отвечает правдоподобной чепухой.
// Сторож — src/lib/dictation.test.ts.
export function resamplePcm(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

// Отсчёты в то, что принимает маршрут: знаковые 16 бит.
//
// Множитель один (0x8000) и тот же, каким маршрут переводит их обратно, —
// иначе тихий перекос копится по всей записи. Округление, а не
// отбрасывание: отбрасывание всегда двигает отсчёт в одну сторону, то
// есть добавляет к речи ровный фон. И потолок отдельно: у Int16
// несимметричный диапазон, и округлённая единица в него не влезает.
export function toInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 0x8000)));
  }
  return out;
}

export type PcmRecording = {
  // Остановить запись и забрать записанное. Микрофон отпускается в любом
  // случае, даже если отсчётов не набралось.
  stop: () => Int16Array;
  // Остановить и выбросить: так уходит отменённая диктовка.
  cancel: () => void;
};

// Открыть микрофон и начать писать. Бросает, если микрофона нет или его не
// дали, — код ошибки тот же, что у Web Speech («not-allowed»,
// «audio-capture»), чтобы объяснение человеку было одно на оба пути.
export async function startPcmRecording(onAutoStop?: () => void): Promise<PcmRecording> {
  type AudioCtor = new (options?: AudioContextOptions) => AudioContext;
  const Ctx: AudioCtor | undefined =
    (window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }).AudioContext ||
    (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctx || !navigator.mediaDevices?.getUserMedia) throw new Error("audio-capture");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Подавление эха и шума оставлено браузеру: комната у всех своя, а
      // Whisper на чистой дорожке ошибается заметно реже.
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    throw new Error(name === "NotAllowedError" || name === "SecurityError" ? "not-allowed" : "audio-capture");
  }

  // Просим контекст сразу на 16 кГц: там, где браузер это умеет, он
  // пересчитает поток сам и лучше нас. Где не умеет — досчитаем ниже,
  // поэтому проверяется РЕАЛЬНАЯ частота контекста, а не запрошенная.
  let ctx: AudioContext;
  try {
    ctx = new Ctx({ sampleRate: TARGET_RATE });
  } catch {
    ctx = new Ctx();
  }
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessorNode объявлен устаревшим, и замена ему — AudioWorklet,
  // который живёт в отдельном файле и загружается по сети. Здесь это не
  // годится по существу: путь включается ИМЕННО тогда, когда со связью
  // что-то не так, и ставить сетевой запрос на дорогу к микрофону значит
  // повторить ту самую поломку, от которой уходим. Узел не удалён ни в
  // одном браузере и для минуты речи работает ровно так же.
  const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
  // Без выхода обработчик молчит в части браузеров, поэтому он подключён к
  // колонкам — но через нулевую громкость: слышать себя человек не должен.
  const mute = ctx.createGain();
  mute.gain.value = 0;

  const chunks: Float32Array[] = [];
  let total = 0;
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    // Копия обязательна: буфер один и тот же, его переиспользуют.
    chunks.push(new Float32Array(input));
    total += input.length;
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  let stopped = false;
  // Предел длительности заводится ВЫШЕ release, который его гасит:
  // «const, позванный выше своей строки» — ровно тот класс ошибки, ради
  // которого в проекте включено no-use-before-define.
  const timer = setTimeout(() => {
    if (!stopped) onAutoStop?.();
  }, MAX_RECORDING_MS);
  const release = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    processor.onaudioprocess = null;
    try {
      source.disconnect();
      processor.disconnect();
      mute.disconnect();
    } catch {
      // Уже отключено — значит и отключать нечего.
    }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };


  return {
    stop: () => {
      const rate = ctx.sampleRate;
      release();
      const merged = new Float32Array(total);
      let at = 0;
      for (const c of chunks) {
        merged.set(c, at);
        at += c.length;
      }
      return toInt16(resamplePcm(merged, rate, TARGET_RATE));
    },
    cancel: release,
  };
}

// Отдать записанное на расшифровку. Возвращает текст; бросает с кодом,
// который умеет объяснить speechErrorText.
export async function transcribeOnServer(pcm: Int16Array, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer,
      signal,
    });
  } catch {
    throw new Error("network");
  }
  if (!res.ok) throw new Error("server");
  const data = (await res.json()) as { text?: string };
  return (data.text || "").trim();
}
