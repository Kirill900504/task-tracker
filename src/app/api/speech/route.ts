import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Расшифровать надиктованное в трекере — нашими силами, без Google.
//
// Зачем это понадобилось. Диктовка в браузере (Web Speech API) только
// выглядит браузерной: Chrome отправляет звук на распознавание в сервис
// Google и приносит текст оттуда. Когда до этого сервиса не достучаться —
// а 21.09.2026 до него не достучались ни Кирилл, ни Витковский, и кнопка
// отвечала «Распознавание речи не отвечает», — чинить в браузере нечего:
// сломано не у нас и не у него. Поэтому у диктовки появился второй путь,
// свой: браузер пишет звук сам и присылает его сюда, а здесь его слушает
// тот же Whisper, который давно расшифровывает голосовые из мессенджеров
// (lib/speechToText).
//
// Тело запроса — сырой звук, без контейнера: моно, 16 кГц, знаковые
// 16-битные отсчёты, младший байт первым. Ровно то, что умеет отдать
// браузер (lib/dictation) и ровно то, что ждёт Whisper, — ни кодека, ни
// разбора формата между ними нет вовсе, и ошибиться поэтому негде.
//
// Отвечает только вошедшим: расшифровка занимает целое ядро на несколько
// секунд, и открытый маршрут был бы приглашением его занять.

export const runtime = "nodejs";
// Холодный старт качает веса модели (~40 МБ) и лишь потом слушает — на
// боевом это примерно 17 секунд, дальше несколько секунд на саму минуту
// речи. Тот же предел, что у голосовых в мессенджере.
export const maxDuration = 60;

// Минута речи: 16000 отсчётов в секунду по два байта. Больше в диктовку
// не наговаривают, а предел заодно держит тело запроса в пределах того,
// что serverless-функция принимает без разговоров.
const MAX_SECONDS = 60;
const MAX_BYTES = 16000 * 2 * MAX_SECONDS;
// Короче этого — не речь, а случайное нажатие: отвечать пустотой дешевле,
// чем будить модель.
const MIN_BYTES = 16000 * 2 * 0.3;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: `Запись длиннее ${MAX_SECONDS} секунд — скажите короче.` }, { status: 413 });
  }
  if (bytes.byteLength < MIN_BYTES) return NextResponse.json({ text: "" });

  // Int16 → Float32 в том же диапазоне, в каком Whisper ждёт звук.
  // Делитель 32768, а не 32767: это множитель кодирования, и он
  // единственный, при котором тишина остаётся тишиной, а не уезжает на
  // полразряда вверх.
  const samples = new Int16Array(bytes.byteLength % 2 === 0 ? bytes : bytes.slice(0, bytes.byteLength - 1));
  const pcm = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = samples[i] / 32768;

  try {
    const { transcribePcm16k } = await import("@/lib/speechToText");
    const text = await transcribePcm16k(pcm);
    return NextResponse.json({ text });
  } catch (e) {
    // Названная причина, а не «не получилось»: этот путь включается
    // тогда, когда первый уже отказал, и человек к этому моменту имеет
    // право знать, что именно происходит.
    const reason = e instanceof Error ? e.message : String(e);
    console.error("speech: transcription failed", reason);
    return NextResponse.json({ error: "Не удалось расшифровать запись." }, { status: 500 });
  }
}
