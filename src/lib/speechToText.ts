import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
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
// avoiding it entirely. So: load its "web" build directly by file path
// instead — that build only ever touches the pure-WASM onnxruntime-web
// backend and never references onnxruntime-node at all.
//
// Getting that path is trickier than it should be: an earlier version used
// require.resolve("@huggingface/transformers") to find where node_modules
// actually put it. That broke in production with "16637.replace is not a
// function" — Turbopack statically analyzes require()/require.resolve()
// call sites with a literal package-name argument and rewrites them to
// reference its OWN internal module registry (a numeric id), even for a
// package marked serverExternalPackages — so the "path" it handed back
// was never a real path at all. Building the path from process.cwd() at
// runtime instead is invisible to that static analysis (no literal
// require()-style call for the bundler to find), so it can only ever
// resolve for real, the way plain Node would.
function findInNodeModules(...segments: string[]): string {
  const all = ["node_modules", ...segments];
  // turbopackIgnore: this path reaches into node_modules, so without the
  // hint Turbopack's tracer defensively assumes it might need *any* file in
  // the project and bundles everything (including /public) into the
  // function — the actual package is already guaranteed to ship in full via
  // serverExternalPackages in next.config.ts, so there's nothing here for
  // the tracer to usefully discover anyway.
  const candidates = [
    path.join(/* turbopackIgnore: true */ process.cwd(), ...all),
    path.join(/* turbopackIgnore: true */ process.cwd(), "..", ...all),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("Could not locate " + all.join("/") + " (looked in: " + candidates.join(", ") + ")");
}

// Even wrapped in a function call, Turbopack still tried to statically
// resolve this import() at *build* time and failed the whole build outright
// ("Module not found") rather than deferring to runtime — a stricter
// failure mode than webpack's usual "critical dependency" warning.
// Constructing the import through `new Function` hides it from every
// bundler's static analysis entirely: the `import()` call only exists
// inside a string compiled by the JS engine at runtime, never as a real
// AST node any build tool parses.
const dynamicImport = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<unknown>;

type TransformersModule = typeof import("@huggingface/transformers");
let transformersPromise: Promise<TransformersModule> | null = null;
function loadTransformers(): Promise<TransformersModule> {
  if (!transformersPromise) {
    // The web build asks "am I in Node?" once, at module-load time, via
    // process.release.name — and when the answer is yes it later requests
    // the model as a FILE PATH, which only the *node* build can produce
    // (it needs the on-disk cache that build owns). The web build has no
    // such cache, so that request dead-ends in "Unable to get model file
    // path or buffer" — exactly the error Telegram voice notes were
    // failing with. Hiding Node during the import makes it take the
    // browser path instead: download the model into a buffer and hand the
    // buffer straight to onnxruntime-web, which is what we want anyway.
    // Restored immediately afterwards so nothing else in the function sees
    // a doctored process.release.
    const originalRelease = process.release;
    Object.defineProperty(process, "release", {
      value: { ...originalRelease, name: "browser-shim" },
      configurable: true,
    });
    const entry = pathToFileURL(findInNodeModules("@huggingface", "transformers", "dist", "transformers.web.js")).href;
    transformersPromise = (dynamicImport(entry) as Promise<TransformersModule>).finally(() => {
      Object.defineProperty(process, "release", { value: originalRelease, configurable: true });
    });
  }
  return transformersPromise;
}

const MODEL_ID = "Xenova/whisper-tiny"; // multilingual (incl. Russian), the smallest Whisper that handles Russian
let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = loadTransformers().then(({ pipeline, env }) => {
      const wasm = env.backends.onnx.wasm;
      if (wasm) {
        wasm.numThreads = 1;
        // ORT's default is to pull its own runtime from a CDN over https,
        // which Node's ESM loader flatly refuses to import ("Only URLs with
        // a scheme in: file and data are supported"). Point it at the copy
        // already sitting in node_modules instead.
        wasm.wasmPaths = pathToFileURL(findInNodeModules("onnxruntime-web", "dist") + path.sep).href;
      }
      // Having made the library believe it is in a browser (see
      // loadTransformers), its "local models" root is a bare "/models/"
      // path it then tries to parse as a URL — which fails for every file.
      // There is no local copy to find anyway: fetch it from the hub.
      env.allowLocalModels = false;
      // Now that the browser path is in play, the device name follows the
      // browser naming too ("wasm", not "cpu").
      //
      // q8 (quantised) rather than fp32: 40MB of weights instead of 152MB,
      // which is what a cold container has to download before it can
      // transcribe anything — measured at ~17s versus ~27s locally. It only
      // became usable after pinning onnxruntime-web to 1.29 (see
      // package.json): on the version transformers pulls in by itself these
      // weights are rejected with "Missing required scale ... MatMulNBits".
      return pipeline("automatic-speech-recognition", MODEL_ID, { device: "wasm", dtype: "q8" });
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
