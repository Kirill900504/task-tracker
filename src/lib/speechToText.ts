import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { OggOpusDecoder } from "ogg-opus-decoder";

// Free, self-hosted speech-to-text for Telegram voice messages — no paid
// API, no external account. Runs entirely inside the Vercel function:
// decode the OGG/Opus voice note to PCM (ogg-opus-decoder, pure WASM, no
// ffmpeg binary needed), resample to the 16kHz mono Whisper expects, then
// transcribe with a small multilingual Whisper model via transformers.js.
//
// Forced onto the WASM ONNX backend (not the native onnxruntime-node
// bindings) on purpose: this function runs in a fresh container on every
// cold start, and a native binary that fails to load there would be a much
// harder failure to diagnose than a slightly slower WASM run.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
// Vercel's writable scratch space — reused across warm invocations of the
// same instance, so the ~40MB model only downloads once per container.
env.cacheDir = "/tmp/whisper-cache";

const MODEL_ID = "Xenova/whisper-tiny"; // multilingual (incl. Russian), ~40MB — small enough for a cold serverless start
let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
      device: "wasm",
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
  }
  return transcriberPromise;
}

function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === 16000) return input;
  const ratio = inputRate / 16000;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    // Linear interpolation — good enough for speech recognition input,
    // no need for a proper band-limited resampler here.
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

export async function transcribeOggOpus(bytes: ArrayBuffer): Promise<string> {
  const decoder = new OggOpusDecoder();
  await decoder.ready;
  const { channelData, sampleRate } = await decoder.decode(new Uint8Array(bytes));
  decoder.free();

  if (!channelData.length || !channelData[0].length) return "";

  // Telegram voice notes are mono, but downmix defensively just in case.
  let mono = channelData[0];
  if (channelData.length > 1) {
    mono = new Float32Array(channelData[0].length);
    for (let i = 0; i < mono.length; i++) {
      let sum = 0;
      for (let c = 0; c < channelData.length; c++) sum += channelData[c][i];
      mono[i] = sum / channelData.length;
    }
  }

  const pcm16k = resampleTo16k(mono, sampleRate);
  const transcriber = await getTranscriber();
  const result = await transcriber(pcm16k, { language: "russian", task: "transcribe" });
  const text = Array.isArray(result) ? result[0]?.text : result.text;
  return (text || "").trim();
}
