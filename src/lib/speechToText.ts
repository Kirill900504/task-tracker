import { createRequire } from "node:module";
// Type-only — erased at compile time, so this never triggers Node's
// "node"-condition module resolution the way a value import would.
import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

// Free, self-hosted speech-to-text for Telegram voice messages — no paid
// API, no external account. Runs entirely inside the Vercel function:
// decode the OGG/Opus voice note to PCM (ogg-opus-decoder, pure WASM, no
// ffmpeg binary needed), resample to the 16kHz mono Whisper expects, then
// transcribe with a small multilingual Whisper model via transformers.js.
//
// @huggingface/transformers picks its entry point via package.json
// "exports" based on which runtime condition Node reports — under Node.js
// that's always its "node" build, which eagerly touches the native
// onnxruntime-node bindings at module-load time regardless of which
// `device` a pipeline() call later asks for. That native addon's shared
// library failed to load in Vercel's serverless container in production
// (confirmed via deploy logs: "libonnxruntime.so.1: cannot open shared
// object file"), and a fresh container on every cold start makes that kind
// of native-loader failure fundamentally harder to keep working than
// avoiding it entirely. So: resolve the package normally (to find where
// node_modules actually put it), then load its "web" build directly by
// file path instead — that build only ever touches the pure-WASM
// onnxruntime-web backend and never references onnxruntime-node at all.
const require = createRequire(import.meta.url);

type TransformersModule = typeof import("@huggingface/transformers");
let transformersPromise: Promise<TransformersModule> | null = null;
function loadTransformers(): Promise<TransformersModule> {
  if (!transformersPromise) {
    const nodeEntry = require.resolve("@huggingface/transformers");
    const webEntry = nodeEntry.replace(/transformers\.node\.(mjs|cjs)$/, "transformers.web.js");
    transformersPromise = import(webEntry) as Promise<TransformersModule>;
  }
  return transformersPromise;
}

const MODEL_ID = "Xenova/whisper-tiny"; // multilingual (incl. Russian), ~40MB — small enough for a cold serverless start
let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = loadTransformers().then(({ pipeline, env }) => {
      if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
      // Vercel's writable scratch space — reused across warm invocations of
      // the same container, so the ~40MB model only downloads once per cold start.
      env.cacheDir = "/tmp/whisper-cache";
      return pipeline("automatic-speech-recognition", MODEL_ID, { device: "wasm" });
    });
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
  const { OggOpusDecoder } = await import("ogg-opus-decoder");
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
